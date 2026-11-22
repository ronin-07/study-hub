"""Phase C2: compact session snapshots, aggregate consistency and Drive index diffs."""
import importlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def api(tmp_path, monkeypatch):
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'c2.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    monkeypatch.delenv('VERCEL', raising=False)
    import app.main as main
    importlib.reload(main)
    return TestClient(main.app), main


def current_monday():
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    return int(datetime(monday.year, monday.month, monday.day,
                        tzinfo=timezone.utc).timestamp())


def test_compact_snapshot_preserves_all_time_counts_and_current_week(api, monkeypatch):
    client, main = api
    week_start = current_monday()
    clock = [week_start - 15 * 86400]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    old = client.post('/api/sessions/start', json={'mode': 'free'}).json()
    clock[0] += 42
    assert client.post(f"/api/sessions/{old['id']}/finish", json={}).status_code == 200
    clock[0] = week_start + 3600
    current = client.post('/api/sessions/start', json={'mode': 'free'}).json()
    clock[0] += 19
    assert client.post(f"/api/sessions/{current['id']}/finish", json={}).status_code == 200
    compact = client.get('/api/snapshot', params={'compact': 'true', 'week_start': week_start})
    assert compact.status_code == 200, compact.text
    snap = compact.json()
    assert snap['focus_stats']['total_seconds'] == 61
    assert snap['focus_stats']['completed_sessions'] == 2
    assert sum(s['focus_seconds'] for s in snap['sessions']
               if s['status'] == 'finished' and s['ended_at'] >= week_start) == 19
    assert len(client.get('/api/snapshot').json()['sessions']) == 2  # backward compatibility


def test_compact_snapshot_limits_history_but_keeps_active_session(api, monkeypatch):
    client, main = api
    week_start = current_monday()
    clock = [week_start - 12 * 86400]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    for _ in range(11):
        old = client.post('/api/sessions/start', json={'mode': 'free'}).json()
        clock[0] += 10
        assert client.post(f"/api/sessions/{old['id']}/finish", json={}).status_code == 200
        clock[0] += 10
    clock[0] = week_start + 100
    active = client.post('/api/sessions/start', json={'mode': 'free'}).json()
    snap = client.get('/api/snapshot', params={'compact': 'true', 'week_start': week_start}).json()
    assert len(snap['sessions']) == 6  # five recent completed, plus active
    assert snap['focus_stats']['completed_sessions'] == 11
    assert snap['focus_stats']['total_seconds'] == 110
    assert any(s['id'] == active['id'] and s['status'] == 'running' for s in snap['sessions'])


def test_deleting_finished_session_subtracts_aggregate(api, monkeypatch):
    client, main = api
    clock = [int(datetime.now(timezone.utc).timestamp()) - 200]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    first = client.post('/api/sessions/start', json={'mode': 'free'}).json()
    clock[0] += 25
    assert client.post(f"/api/sessions/{first['id']}/finish", json={}).status_code == 200
    stats = client.get('/api/snapshot', params={'compact': 'true', 'week_start': current_monday()}).json()['focus_stats']
    assert stats['total_seconds'] == 25
    assert client.delete('/api/sessions/' + first['id']).status_code == 204
    stats = client.get('/api/snapshot', params={'compact': 'true', 'week_start': current_monday()}).json()['focus_stats']
    assert stats['total_seconds'] == 0 and stats['completed_sessions'] == 0


def test_first_compact_request_migrates_legacy_finished_sessions(api):
    client, main = api
    store = main.app_store
    store.put('local-owner', 'sessions', {
        'id':'historical-record', 'status':'finished', 'ended_at':1000,
        'focus_seconds':155, 'started_at':845, 'mode':'free',
    })
    snap = client.get('/api/snapshot', params={'compact': 'true', 'week_start': current_monday()}).json()
    assert snap['focus_stats']['total_seconds'] == 155
    assert store.get('local-owner','focus_summary','state')['total_seconds'] == 155
    assert snap['sessions'][0]['id'] == 'historical-record'


def test_compact_requires_recent_week_start(api):
    client, _ = api
    assert client.get('/api/snapshot?compact=true').status_code == 422
    assert client.get('/api/snapshot?compact=true&week_start=0').status_code == 422


def test_drive_index_diff_skips_unchanged_updates_and_prunes_missing(api):
    _client, main = api
    store = main.app_store
    uid = 'local-owner'
    initial = {'abc': {'id':'abc', 'name':'Week 1.pdf', 'path':'Goodnotes'},
               'def': {'id':'def', 'name':'Week 2.pdf', 'path':'Goodnotes'}}
    assert store.sync_index(uid, initial) == {'added':2, 'updated':0, 'removed':0}
    assert store.sync_index(uid, initial) == {'added':0, 'updated':0, 'removed':0}
    updated = {'abc': initial['abc'], 'xyz': {'id':'xyz', 'name':'Week 3.pdf', 'path':'Goodnotes'}}
    assert store.sync_index(uid, updated) == {'added':1, 'updated':0, 'removed':1}
    assert {r['id'] for r in store.list(uid,'drive-index')} == {'abc','xyz'}
    changed = {'abc': {**initial['abc'], 'name':'Updated.pdf'}, 'xyz': updated['xyz']}
    assert store.sync_index(uid, changed) == {'added':0, 'updated':1, 'removed':0}


def test_drive_scan_second_pass_is_read_only_for_unchanged_index(api, monkeypatch):
    """Repeat scan should not emit one Firestore write per unchanged PDF."""
    client, main = api
    import app.drive as drive
    store = main.app_store
    folder_id = 'goodnotesFolder123'
    store.put('local-owner', 'drive-settings', {
        'id': 'source-folder', 'folder_id': folder_id, 'name':'Backup'})
    class FakeHttpClient:
        def __init__(self, **_kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass
    async def auth(*_args): return 'mock-access'
    async def children(_client, _access, _folder_id):
        return [{'id':'filePDF123', 'name':'Lecture.pdf', 'mimeType':drive.PDF_MIME}]
    monkeypatch.setattr(drive, 'access_token', auth)
    monkeypatch.setattr(drive.httpx, 'AsyncClient', FakeHttpClient)
    monkeypatch.setattr(drive, '_children', children)
    first = client.post('/api/drive/scan')
    assert first.status_code == 200, first.text
    assert first.json()['changes'] == {'added':1,'updated':0,'removed':0}
    second = client.post('/api/drive/scan')
    assert second.status_code == 200, second.text
    assert second.json()['changes'] == {'added':0,'updated':0,'removed':0}
    assert second.json()['count'] == 1
