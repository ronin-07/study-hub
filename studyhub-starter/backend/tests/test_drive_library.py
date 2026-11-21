"""v0.3 Goodnotes folder indexing and review-first matching tests (no live Google calls)."""
import importlib
import pytest
from fastapi.testclient import TestClient

from app.matching import detect_kind, suggest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'test.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    import app.main as main
    import app.drive as drive
    importlib.reload(main)
    importlib.reload(drive)
    return TestClient(main.app)


def test_matching_requires_unambiguous_week_and_course():
    courses = [dict(id='cv', code='02516', week_count=13), dict(id='ml', code='02450', week_count=13)]
    weeks = [dict(course_id='cv', number=10, title='Segmentation')]
    match = suggest('Goodnotes/02516/Week 10', 'IDLCV_L10_MultiClass_notes.pdf', courses, weeks)
    assert match['course_code'] == '02516'
    assert match['week_number'] == 10
    assert match['kind'] == 'handwritten'
    assert match['confidence'] == 'high'
    assert match['week_title'] == 'Segmentation'
    assert suggest('Goodnotes/Random', 'notes.pdf', courses, weeks) is None
    assert suggest('Goodnotes/02516', 'W10 W11 notes.pdf', courses, weeks) is None
    assert suggest('Goodnotes/02516', 'Week 21.pdf', courses, weeks) is None
    assert detect_kind('annotatedSlides.pdf') == 'annotated'
    assert suggest('Goodnotes/02450/W02', 'slides.pdf', courses, weeks)['week_number'] == 2


def test_reading_position_and_duplicate_links(client):
    c = client.post('/api/courses', json={'code': '02516', 'title': 'Image Analysis'}).json()
    body = {'course_id': c['id'], 'week_number': 10, 'title': 'Notes',
            'source': 'drive', 'drive_file_id': 'goodnotesABC123', 'kind': 'handwritten'}
    created = client.post('/api/resources', json=body)
    assert created.status_code == 201
    assert created.json()['last_page'] == 1
    assert client.post('/api/resources', json=body).status_code == 409
    url = '/api/resources/' + created.json()['id'] + '/reading-position'
    assert client.patch(url, json={'page': 24}).json()['last_page'] == 24
    assert client.patch(url, json={'page': 0}).status_code == 422
    assert client.get('/api/snapshot').json()['resources'][0]['last_page'] == 24


def test_selected_folder_scan_only_metadata_and_requires_user_confirmation(client, monkeypatch):
    import app.drive as drive
    c = client.post('/api/courses', json={'code': '02516', 'title': 'CV'}).json()
    client.post('/api/weeks', json={'course_id': c['id'], 'number': 10, 'title': 'Multiclass'})

    async def auth(*_args):
        return 'mock-access-token'

    class FakeResponse:
        status_code = 200

        def json(self):
            return {'id': 'goodnotesFolder123', 'name': 'Goodnotes',
                    'mimeType': drive.FOLDER_MIME, 'trashed': False}

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

        async def get(self, *_args, **_kwargs):
            return FakeResponse()

    async def children(_client, _access, folder_id):
        if folder_id == 'goodnotesFolder123':
            return [{'id': 'cvFolder123', 'name': '02516', 'mimeType': drive.FOLDER_MIME}]
        return [{'id': 'goodnotesPdf123', 'name': 'Week 10 handwritten notes.pdf',
                 'mimeType': drive.PDF_MIME, 'modifiedTime': '2026-11-21T11:00:00.000Z', 'size': '12000'}]

    monkeypatch.setattr(drive, 'access_token', auth)
    monkeypatch.setattr(drive.httpx, 'AsyncClient', FakeClient)
    monkeypatch.setattr(drive, '_children', children)
    assert client.post('/api/drive/scan').status_code == 409
    choice = client.post('/api/drive/source-folder', json={'folder_id': 'goodnotesFolder123'})
    assert choice.status_code == 200
    assert client.get('/api/drive/source-folder').json()['folder']['name'] == 'Goodnotes'
    scanned = client.post('/api/drive/scan')
    assert scanned.status_code == 200
    entry = scanned.json()['files'][0]
    assert entry['suggestion']['course_id'] == c['id']
    assert entry['suggestion']['week_number'] == 10
    assert entry['links'] == []  # suggestions never create resource records
    assert client.get('/api/snapshot').json()['resources'] == []
    assert client.get('/api/drive/index').json()['files'][0]['id'] == 'goodnotesPdf123'
    # A repeated scan preserves existing links.
    client.post('/api/resources', json={'course_id': c['id'], 'week_number': 10,
                'title': entry['name'], 'source': 'drive', 'drive_file_id': entry['id']})
    assert len(client.post('/api/drive/scan').json()['files'][0]['links']) == 1


def test_folder_scan_failure_keeps_old_index(client, monkeypatch):
    import app.drive as drive
    store = drive._store()
    store.put('local-owner', 'drive-settings', {'id': 'source-folder', 'folder_id': 'goodnotesFolder123', 'name': 'Backup'})
    store.put('local-owner', 'drive-index', {'id': 'oldPdf123', 'name': 'Old.pdf', 'path': 'Backup'})
    async def auth(*_):
        return 'token'

    class FakeClient:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass

    async def fail(*_):
        from fastapi import HTTPException
        raise HTTPException(502, 'Google unavailable')

    monkeypatch.setattr(drive, 'access_token', auth)
    monkeypatch.setattr(drive.httpx, 'AsyncClient', FakeClient)
    monkeypatch.setattr(drive, '_children', fail)
    assert client.post('/api/drive/scan').status_code == 502
    assert client.get('/api/drive/index').json()['files'][0]['id'] == 'oldPdf123'
