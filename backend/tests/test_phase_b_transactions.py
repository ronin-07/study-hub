"""Phase B: local transactional invariants (Firestore is separately emulator-tested in CI)."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4
import importlib

import pytest
from fastapi.testclient import TestClient

from app.storage import ActiveSessionExists, SQLiteStore


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'api.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    import app.main as main
    importlib.reload(main)
    return TestClient(main.app), main


def test_multiple_instances_cannot_create_two_active_sessions(tmp_path):
    path = str(tmp_path / 'concurrent.sqlite3')
    stores = [SQLiteStore(path) for _ in range(8)]
    gate = Barrier(len(stores))

    def start(i):
        gate.wait()
        try:
            stores[i].start_focus_atomic('same-user', {
                'id': uuid4().hex, 'status': 'running', 'started_at': 100
            })
            return True
        except ActiveSessionExists:
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(start, range(8)))
    assert outcomes.count(True) == 1
    assert len(stores[0].list('same-user', 'sessions')) == 1
    assert stores[0].get('same-user', 'focus_guard', 'active')['session_id'] == stores[0].list('same-user', 'sessions')[0]['id']

    # The guard is per user, not global across every account.
    stores[0].start_focus_atomic('other-user', {'id': 'new', 'status': 'running', 'started_at': 100})


def test_focus_transitions_release_guard_and_exclude_pauses(client, monkeypatch):
    api, main = client
    clock = [1000]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    start = api.post('/api/sessions/start', json={'mode': 'free'})
    assert start.status_code == 201
    identifier = start.json()['id']
    assert api.post('/api/sessions/start', json={'mode': 'free'}).status_code == 409
    clock[0] = 1010
    assert api.post(f'/api/sessions/{identifier}/pause').status_code == 200
    assert api.post(f'/api/sessions/{identifier}/pause').status_code == 409
    clock[0] = 1050
    assert api.post(f'/api/sessions/{identifier}/resume').status_code == 200
    clock[0] = 1060
    assert api.post(f'/api/sessions/{identifier}/finish', json={'confirmed_seconds': 21}).status_code == 422
    assert api.post(f'/api/sessions/{identifier}/finish', json={'confirmed_seconds': 20}).status_code == 200
    assert api.post(f'/api/sessions/{identifier}/finish', json={}).status_code == 409
    # A failed finish must not release the guard, a successful one must.
    assert api.post('/api/sessions/start', json={'mode': 'free'}).status_code == 201


def test_deleting_running_session_releases_guard(client):
    api, _ = client
    entry = api.post('/api/sessions/start', json={'mode': 'free'}).json()
    assert api.delete('/api/sessions/' + entry['id']).status_code == 204
    assert api.post('/api/sessions/start', json={'mode': 'free'}).status_code == 201


def test_concurrent_recurrence_completion_creates_only_one_successor(client):
    api, _ = client
    item = api.post('/api/items', json={'title': 'Study', 'kind': 'personal',
        'planned_date': '2026-11-23', 'repeat': 'daily'}).json()
    barrier = Barrier(6)

    def complete(_):
        barrier.wait()
        return api.patch('/api/items/' + item['id'], json={'done': True}).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(complete, range(6)))
    assert results == [200] * 6
    rows = api.get('/api/snapshot').json()['items']
    assert len(rows) == 2
    assert len({row['id'] for row in rows}) == 2
    assert next(row for row in rows if row['id'] != item['id'])['planned_date'] == '2026-11-24'


def test_atomic_item_transaction_rolls_back_on_successor_failure(tmp_path):
    store = SQLiteStore(str(tmp_path / 'rollback.sqlite3'))
    original = {'id': 'first', 'done': False, 'title': 'Example'}
    store.create('a', 'items', original)

    def invalid_child(current):
        return {**current, 'done': True, 'invalid': object()}, {'id': 'successor', 'done': False}

    with pytest.raises(TypeError):
        store.update_item_atomic('a', 'first', invalid_child)
    assert store.get('a', 'items', 'first')['done'] is False
    assert len(store.list('a', 'items')) == 1


def test_concurrent_edits_to_different_fields_preserve_both(tmp_path):
    path = str(tmp_path / 'edits.sqlite3')
    stores = [SQLiteStore(path), SQLiteStore(path)]
    stores[0].create('a', 'items', {'id': 'first', 'title': 'Old', 'notes': ''})
    barrier = Barrier(2)

    def patch(i):
        barrier.wait()
        def change(existing):
            existing['title' if i == 0 else 'notes'] = 'New'
            return existing, None
        return stores[i].update_item_atomic('a', 'first', change)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(patch, range(2)))
    assert stores[0].get('a', 'items', 'first')['title'] == 'New'
    assert stores[0].get('a', 'items', 'first')['notes'] == 'New'
