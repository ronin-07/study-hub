"""Release gate: zero-second Focus sessions are discarded, not completed."""
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def context(tmp_path, monkeypatch):
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'zero-focus.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    monkeypatch.delenv('VERCEL', raising=False)
    import app.main as main
    importlib.reload(main)
    clock = [1000]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    return TestClient(main.app), main, clock


def test_zero_seconds_cannot_be_saved_and_discard_releases_active_guard(context):
    client, main, clock = context
    session = client.post('/api/sessions/start', json={'mode': 'free'}).json()
    url = f"/api/sessions/{session['id']}"
    assert client.post(url + '/pause', json={'displayed_seconds': 0}).status_code == 200
    rejected = client.post(url + '/finish', json={'confirmed_seconds': 0})
    assert rejected.status_code == 422
    assert 'discard' in rejected.json()['detail'].lower()
    assert main.app_store.get('local-owner', 'sessions', session['id'])['status'] == 'paused'
    assert client.post('/api/sessions/start', json={'mode': 'free'}).status_code == 409
    assert client.delete(url).status_code == 204
    assert main.app_store.get('local-owner', 'sessions', session['id']) is None
    assert main.app_store.get('local-owner', 'focus_guard', 'active') is None
    assert client.post('/api/sessions/start', json={'mode': 'free'}).status_code == 201
    assert main.app_store.focus_overview('local-owner', 0)['focus_stats']['completed_sessions'] == 0


def test_zero_confirmed_seconds_rejected_even_if_server_elapsed_time_is_positive(context):
    client, main, clock = context
    session = client.post('/api/sessions/start', json={'mode': '50'}).json()
    clock[0] += 20
    client.post(f"/api/sessions/{session['id']}/pause", json={'displayed_seconds': 20})
    rejected = client.post(f"/api/sessions/{session['id']}/finish", json={'confirmed_seconds': 0})
    assert rejected.status_code == 422
    assert main.app_store.get('local-owner', 'sessions', session['id'])['status'] == 'paused'
    assert main.app_store.focus_overview('local-owner', 0)['focus_stats']['completed_sessions'] == 0
    assert client.delete(f"/api/sessions/{session['id']}").status_code == 204


def test_omitted_confirmation_cannot_finish_at_zero_but_nonzero_finishes_normally(context):
    client, main, clock = context
    session = client.post('/api/sessions/start', json={'mode': '25'}).json()
    url = f"/api/sessions/{session['id']}"
    assert client.post(url + '/finish', json={}).status_code == 422
    clock[0] += 1
    result = client.post(url + '/finish', json={})
    assert result.status_code == 200
    assert result.json()['focus_seconds'] == 1
    assert main.app_store.focus_overview('local-owner', 0)['focus_stats'] == {
        'id': 'state', 'total_seconds': 1, 'completed_sessions': 1}


def test_existing_zero_length_records_are_excluded_from_new_statistics(context):
    _client, main, _clock = context
    main.app_store.put('local-owner', 'sessions', {
        'id': 'legacy-zero', 'status': 'finished', 'started_at': 100, 'ended_at': 100,
        'focus_seconds': 0, 'mode': 'free'
    })
    snap = main.app_store.focus_overview('local-owner', 0)
    assert snap['focus_stats']['total_seconds'] == 0
    assert snap['focus_stats']['completed_sessions'] == 0
    assert snap['sessions'] == []
    main.app_store.delete_focus_atomic('local-owner', 'legacy-zero')
    assert main.app_store.focus_overview('local-owner', 0)['focus_stats']['completed_sessions'] == 0
