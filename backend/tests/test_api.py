from tests.helpers import create_course
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
    course = create_course(client, {'code': '02516', 'title': 'Image Analysis'}).json()
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
    course = create_course(client, {'code': '02450', 'title': 'ML'}).json()
    planned = client.post('/api/items', json={
        'course_id': course['id'], 'week_number': 2, 'title': 'Read chapter 3',
        'kind': 'reading', 'planned_date': '2026-11-30', 'is_task': False
    }).json()
    assert planned['is_task'] is True


def test_cross_course_resource_association_rejected(client):
    a = create_course(client, {'code': '02516', 'title': 'CV'}).json()
    b = create_course(client, {'code': '02450', 'title': 'ML'}).json()
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


def test_focus_session_can_link_personal_task_without_course(client):
    task = client.post('/api/items', json={
        'kind': 'personal', 'title': 'Read for 20 minutes', 'planned_date': '2026-11-22'
    })
    assert task.status_code == 201
    started = client.post('/api/sessions/start', json={
        'mode': '25', 'item_id': task.json()['id'], 'course_id': None, 'week_number': None
    })
    assert started.status_code == 201, started.text
    assert started.json()['item_id'] == task.json()['id']
    assert started.json()['course_id'] is None


def test_items_only_refresh_and_server_timing_header(client):
    item = client.post('/api/items', json={'kind': 'personal', 'title': 'Quick update'}).json()
    completed = client.patch(f"/api/items/{item['id']}", json={'done': True})
    assert completed.status_code == 200
    assert completed.json()['done'] is True
    assert 'Server-Timing' in completed.headers
    refreshed = client.get('/api/items')
    assert refreshed.status_code == 200
    assert [i['id'] for i in refreshed.json()] == [item['id']]
    assert refreshed.json()[0]['done'] is True
    assert 'api;dur=' in refreshed.headers['Server-Timing']


def test_course_name_edit_does_not_read_unrelated_collections(client, monkeypatch):
    import app.main as main
    course = create_course(client, {'code': '02516', 'title': 'Original title'}).json()
    store = main.app_store
    old_list = store.list
    scanned = []

    def recording_list(uid, kind):
        scanned.append(kind)
        return old_list(uid, kind)

    monkeypatch.setattr(store, 'list', recording_list)
    response = client.patch(f"/api/courses/{course['id']}", json={'title': 'Renamed course'})
    assert response.status_code == 200
    assert response.json()['title'] == 'Renamed course'
    assert not any(kind in scanned for kind in ('weeks', 'items', 'resources'))


def test_cloud_snapshot_reads_collections_concurrently(client, monkeypatch):
    import threading
    import app.main as main
    barrier = threading.Barrier(6, timeout=3)
    observed = []
    def fake_collection_list(uid, kind):
        barrier.wait()  # would fail if Firestore collection reads were serialized
        observed.append(kind)
        return []
    monkeypatch.setenv('STORAGE_BACKEND', 'firestore')
    monkeypatch.setattr(main, 'all_docs', fake_collection_list)
    response = client.get('/api/snapshot')
    assert response.status_code == 200
    assert set(observed) == {'courses', 'weeks', 'items', 'resources', 'sessions', 'semesters'}
    assert all(not values for values in response.json().values())


def test_cannot_plan_after_due_date_on_create_or_reschedule(client):
    invalid = client.post('/api/items', json={
        'kind': 'personal', 'title': 'Late plan',
        'planned_date': '2026-11-27', 'due_date': '2026-11-26',
    })
    assert invalid.status_code == 422
    assert 'Planned work date cannot be after the deadline' in invalid.text
    assert client.get('/api/items').json() == []

    created = client.post('/api/items', json={
        'kind': 'personal', 'title': 'Submit project',
        'planned_date': '2026-11-25', 'due_date': '2026-11-26',
    })
    assert created.status_code == 201
    task_id = created.json()['id']
    assert client.patch(f'/api/items/{task_id}', json={'planned_date': '2026-11-26'}).status_code == 200
    rejected = client.patch(f'/api/items/{task_id}', json={'planned_date': '2026-11-27'})
    assert rejected.status_code == 422
    saved = next(t for t in client.get('/api/items').json() if t['id'] == task_id)
    assert saved['planned_date'] == '2026-11-26'
    assert saved['due_date'] == '2026-11-26'


def test_reject_deadline_change_that_precedes_existing_plan(client):
    created = client.post('/api/items', json={
        'kind': 'personal', 'title': 'Reading',
        'planned_date': '2026-11-24', 'due_date': '2026-11-30',
    }).json()
    response = client.patch(f"/api/items/{created['id']}", json={'due_date': '2026-11-23'})
    assert response.status_code == 422
    persisted = client.get('/api/items').json()[0]
    assert persisted['due_date'] == '2026-11-30'
    assert client.patch(f"/api/items/{created['id']}", json={'due_date': None}).status_code == 200
    assert client.patch(f"/api/items/{created['id']}", json={'planned_date': '2026-12-02'}).status_code == 200


def test_legacy_misaligned_dates_can_be_completed_without_data_migration(client):
    # An old v0.5 task may already have a plan later than its due date.
    # The new scheduling rule must not block its completion or non-date edits.
    import app.main as main
    from app.models import Item
    legacy = Item(kind='personal', title='Legacy deadline',
                  planned_date='2026-11-28', due_date='2026-11-25').model_dump(mode='json')
    main.app_store.put('local-owner', 'items', legacy)
    done = client.patch('/api/items/' + legacy['id'], json={'done': True})
    assert done.status_code == 200
    assert done.json()['done'] is True
    corrected = client.patch('/api/items/' + legacy['id'], json={'planned_date': '2026-11-25'})
    assert corrected.status_code == 200
