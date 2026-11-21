import importlib
from fastapi.testclient import TestClient
import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'test.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    import app.main as main
    import app.drive as drive
    importlib.reload(main)
    importlib.reload(drive)
    # The router registered by main uses the live app_store when resolving calls.
    return TestClient(main.app)


def test_course_week_linked_item_and_task_completion(client):
    course = client.post('/api/courses', json={'code': '02516', 'title': 'Image Analysis'}).json()
    assert course['code'] == '02516'
    week = client.post('/api/weeks', json={'course_id': course['id'], 'number': 10, 'title': 'Multiclass segmentation'})
    assert week.status_code == 201
    item = client.post('/api/items', json={'course_id': course['id'], 'week_number': 10, 'kind': 'assignment', 'title': 'Project 3'})
    assert item.status_code == 201
    obj = item.json()
    assert obj['is_task'] is True
    done = client.patch('/api/items/' + obj['id'], json={'done': True})
    assert done.status_code == 200
    snapshot = client.get('/api/snapshot').json()
    assert snapshot['items'][0]['done'] is True
    assert len([i for i in snapshot['items'] if i['is_task']]) == 1


def test_planned_and_due_dates_are_separate(client):
    item = client.post('/api/items', json={'kind': 'personal', 'title': 'Plan reading', 'planned_date': '2026-11-23', 'due_date': '2026-11-27'}).json()
    patched = client.patch('/api/items/' + item['id'], json={'planned_date': '2026-11-24'}).json()
    assert patched['due_date'] == '2026-11-27'
    assert patched['planned_date'] == '2026-11-24'


def test_focus_pause_resume_finish(client, monkeypatch):
    import app.main as main
    clock = [1000]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    started = client.post('/api/sessions/start', json={'mode': '25'}).json()
    assert started['started_at'] == 1000
    assert client.post('/api/sessions/start', json={'mode': '50'}).status_code == 409
    clock[0] += 60
    assert client.post(f"/api/sessions/{started['id']}/pause").json()['status'] == 'paused'
    clock[0] += 30
    assert client.post(f"/api/sessions/{started['id']}/resume").json()['status'] == 'running'
    clock[0] += 90
    ended = client.post(f"/api/sessions/{started['id']}/finish", json={}).json()
    assert ended['focus_seconds'] == 150
    assert ended['status'] == 'finished'
    assert client.post('/api/sessions/start', json={'mode': '50'}).status_code == 201


def test_reject_invalid_resources_and_context(client):
    bad = client.post('/api/resources', json={'course_id': 'fake', 'week_number': 1, 'title': 'slide', 'source': 'link', 'url': 'javascript:alert(1)'})
    assert bad.status_code == 422
    bad_week = client.post('/api/items', json={'title': 'orphan', 'kind': 'reading', 'week_number': 2})
    assert bad_week.status_code == 422


def test_private_drive_endpoints_unconfigured(client):
    assert client.get('/api/drive/status').json()['connected'] is False
    assert client.get('/api/drive/connect').status_code == 503


def test_scheduled_reading_automatically_appears_in_tasks(client):
    course = client.post('/api/courses', json={'code': '02450', 'title': 'ML'}).json()
    planned = client.post('/api/items', json={
        'course_id': course['id'], 'week_number': 2, 'title': 'Read chapter 3',
        'kind': 'reading', 'planned_date': '2026-11-30', 'is_task': False
    }).json()
    assert planned['is_task'] is True


def test_cross_course_resource_association_rejected(client):
    a = client.post('/api/courses', json={'code': '02516', 'title': 'CV'}).json()
    b = client.post('/api/courses', json={'code': '02450', 'title': 'ML'}).json()
    item = client.post('/api/items', json={'course_id': a['id'], 'week_number': 1, 'title': 'Slides', 'kind': 'lecture'}).json()
    resource = client.post('/api/resources', json={'course_id': b['id'], 'week_number': 1, 'title': 'Lecture', 'kind': 'slides', 'source': 'link', 'url': 'https://example.com/s.pdf', 'item_id': item['id']})
    assert resource.status_code == 422


def test_cannot_claim_more_focus_time_than_elapsed(client, monkeypatch):
    import app.main as main
    clock = [1000]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    session = client.post('/api/sessions/start', json={'mode': 'free'}).json()
    clock[0] = 1060
    url = f"/api/sessions/{session['id']}/finish"
    assert client.post(url, json={'confirmed_seconds': 61}).status_code == 422
    checked = client.post(url, json={'confirmed_seconds': 42})
    assert checked.status_code == 200
    assert checked.json()['focus_seconds'] == 42


def test_oauth_state_signature_protection():
    from fastapi import HTTPException
    from app.drive import _decode_state, _state
    state = _state('local-owner', 'my_very_long_server_secret')
    assert _decode_state(state, 'my_very_long_server_secret') == 'local-owner'
    with pytest.raises(HTTPException) as info:
        _decode_state(state[:-1] + ('a' if state[-1] != 'a' else 'b'), 'my_very_long_server_secret')
    assert info.value.status_code == 400
