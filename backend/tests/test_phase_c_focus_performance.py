"""Ensure a slow pause request cannot add seconds beyond what the client saw."""
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def setup_api(tmp_path, monkeypatch):
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'focus.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    import app.main as main
    importlib.reload(main)
    current = [1000]
    monkeypatch.setattr(main, 'now_s', lambda: current[0])
    return TestClient(main.app), current


def test_pause_accepts_click_duration_and_ignores_network_delay(setup_api):
    api, current = setup_api
    session = api.post('/api/sessions/start', json={'mode': 'free'}).json()
    current[0] = 1011  # the client saw 9 seconds; 2 seconds spent in transit.
    paused = api.post(f"/api/sessions/{session['id']}/pause", json={'displayed_seconds': 9})
    assert paused.status_code == 200
    assert paused.json()['status'] == 'paused'
    assert paused.json()['accumulated_pause_seconds'] == 2
    current[0] = 1100
    saved = api.post(f"/api/sessions/{session['id']}/finish", json={'confirmed_seconds': 9})
    assert saved.status_code == 200
    assert saved.json()['focus_seconds'] == 9


def test_pause_never_inflates_elapsed_time_even_with_malicious_claim(setup_api):
    api, current = setup_api
    session = api.post('/api/sessions/start', json={'mode': 'free'}).json()
    current[0] = 1006
    paused = api.post(f"/api/sessions/{session['id']}/pause", json={'displayed_seconds': 50})
    assert paused.status_code == 200
    assert paused.json()['accumulated_pause_seconds'] == 0
    assert api.post(f"/api/sessions/{session['id']}/finish", json={'confirmed_seconds': 7}).status_code == 422
    assert api.post(f"/api/sessions/{session['id']}/finish", json={'confirmed_seconds': 6}).status_code == 200


def test_missing_pause_body_preserves_existing_clients_and_resume(setup_api):
    api, current = setup_api
    session = api.post('/api/sessions/start', json={'mode': 'free'}).json()
    current[0] = 1007
    paused = api.post(f"/api/sessions/{session['id']}/pause")
    assert paused.status_code == 200
    assert paused.json()['accumulated_pause_seconds'] == 0
    current[0] = 1020
    assert api.post(f"/api/sessions/{session['id']}/resume").status_code == 200
    current[0] = 1030
    saved = api.post(f"/api/sessions/{session['id']}/finish", json={})
    assert saved.json()['focus_seconds'] == 17


def test_invalid_negative_pause_duration_rejected(setup_api):
    api, current = setup_api
    session = api.post('/api/sessions/start', json={'mode': 'free'}).json()
    current[0] = 1005
    assert api.post(f"/api/sessions/{session['id']}/pause", json={'displayed_seconds': -3}).status_code == 422
    # A failed validation never mutates the active session.
    assert api.post(f"/api/sessions/{session['id']}/pause", json={'displayed_seconds': 5}).status_code == 200


def test_start_uses_bounded_click_time_to_hide_request_delay(setup_api):
    api, current = setup_api
    session = api.post('/api/sessions/start', json={'mode': 'free', 'requested_at': 998})
    assert session.status_code == 201
    assert session.json()['started_at'] == 998
    assert 'requested_at' not in session.json()


def test_start_timestamp_cannot_be_backdated_more_than_five_seconds(setup_api):
    api, current = setup_api
    assert api.post('/api/sessions/start', json={'mode': 'free', 'requested_at': 1}).json()['started_at'] == 995
    # One active Focus session per user remains enforced.
    assert api.post('/api/sessions/start', json={'mode': 'free', 'requested_at': 2000}).status_code == 409


def test_resume_uses_click_timestamp_not_delayed_request_arrival(setup_api):
    api, current = setup_api
    session = api.post('/api/sessions/start', json={'mode': 'free'}).json()
    current[0] = 1021
    assert api.post(f"/api/sessions/{session['id']}/pause", json={'displayed_seconds': 21}).status_code == 200
    current[0] = 1052  # user clicked Resume at 1050; API took two seconds
    resumed = api.post(f"/api/sessions/{session['id']}/resume", json={'requested_at': 1050})
    assert resumed.status_code == 200
    assert resumed.json()['accumulated_pause_seconds'] == 29
    current[0] = 1062
    assert api.post(f"/api/sessions/{session['id']}/pause", json={'displayed_seconds': 33}).status_code == 200
    assert api.post(f"/api/sessions/{session['id']}/finish", json={'confirmed_seconds': 33}).status_code == 200


def test_resume_timestamp_is_bounded_and_old_client_is_supported(setup_api):
    api, current = setup_api
    session = api.post('/api/sessions/start', json={'mode': 'free'}).json()
    current[0] = 1010
    assert api.post(f"/api/sessions/{session['id']}/pause").status_code == 200
    current[0] = 1020
    # Arbitrary old timestamps are clamped, not trusted.
    resumed = api.post(f"/api/sessions/{session['id']}/resume", json={'requested_at': 1})
    assert resumed.status_code == 200
    assert resumed.json()['accumulated_pause_seconds'] == 5
    current[0] = 1021
    assert api.post(f"/api/sessions/{session['id']}/pause").status_code == 200
    current[0] = 1022
    assert api.post(f"/api/sessions/{session['id']}/resume").status_code == 200
