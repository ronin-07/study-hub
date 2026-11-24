"""Smoke tests for production fail-closed configuration."""

import hashlib

import pytest

from app.storage import get_store


def test_vercel_never_uses_sqlite(monkeypatch):
    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'firebase')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    with pytest.raises(RuntimeError, match='Vercel requires'):
        get_store()


def test_vercel_never_uses_local_auth(monkeypatch):
    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'firestore')
    with pytest.raises(RuntimeError, match='Vercel requires'):
        get_store()


def test_unknown_storage_backend_is_error(monkeypatch):
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.setenv('STORAGE_BACKEND', 'bad-option')
    with pytest.raises(RuntimeError, match='Unknown'):
        get_store()


@pytest.fixture
def drive_pdf(monkeypatch, tmp_path):
    import importlib
    from fastapi.testclient import TestClient

    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'cloud_pdf_test.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    import app.main as main
    import app.drive as drive
    importlib.reload(main)
    importlib.reload(drive)

    class FakeResponse:
        def __init__(self, payload=None, body=b'', status=200):
            self.status_code = status
            self.payload = payload or {}
            self.body = body

        def json(self):
            return self.payload

        async def aclose(self):
            return None

        async def aiter_bytes(self, chunk_size=65536):
            for start in range(0, len(self.body), chunk_size):
                yield self.body[start:start + chunk_size]

    expected = b'%PDF-1.4\n' + b'P' * (5 * 1024 * 1024)
    checksum = hashlib.sha256(expected).hexdigest()
    fixture = {
        'payload': {'mimeType': 'application/pdf', 'size': str(len(expected)), 'sha256Checksum': checksum,
                    'capabilities': {'canDownload': True}},
        'body': expected, 'metadata_status': 200, 'token_reads': 0, 'media_reads': 0, 'etag': f'"sha256-{checksum}"',
    }

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def get(self, *_args, **_kwargs):
            return FakeResponse(fixture['payload'], status=fixture['metadata_status'])

        def build_request(self, method, url, **kwargs):
            return (method, url, kwargs)

        async def send(self, *_args, **_kwargs):
            fixture['media_reads'] += 1
            return FakeResponse(body=fixture['body'])

        async def aclose(self):
            pass

    async def fake_token(*_):
        fixture['token_reads'] += 1
        return 'test-token'

    monkeypatch.setattr(drive, 'access_token', fake_token)
    monkeypatch.setattr(drive.httpx, 'AsyncClient', FakeClient)
    return TestClient(main.app), fixture


PDF_ROUTE = '/api/drive/files/knownDrivePdf123/pdf'


def test_pdf_preview_uses_streaming_response(drive_pdf):
    client, fixture = drive_pdf
    response = client.get(PDF_ROUTE)
    assert response.status_code == 200
    assert response.content == fixture['body']
    assert response.headers['etag'] == fixture['etag']
    assert int(response.headers['content-length']) == len(fixture['body'])
    assert response.headers['content-type'].startswith('application/pdf')
    assert response.headers['cache-control'] == 'private, no-store'


def test_pdf_reopens_without_requesting_media_after_authorization(drive_pdf):
    client, fixture = drive_pdf
    response = client.get(PDF_ROUTE, headers={'If-None-Match': fixture['etag'], 'Origin': 'http://127.0.0.1:3000'})
    assert response.status_code == 304
    assert response.content == b''
    assert response.headers['etag'] == fixture['etag']
    assert response.headers['cache-control'] == 'private, no-store'
    assert 'ETag' in response.headers['access-control-expose-headers']
    assert fixture['token_reads'] == 1
    assert fixture['media_reads'] == 0
    preflight = client.options(PDF_ROUTE, headers={
        'Origin': 'http://127.0.0.1:3000', 'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, If-None-Match',
    })
    assert preflight.status_code == 200


def test_pdf_revalidation_requires_firebase_authorization(drive_pdf, monkeypatch):
    client, fixture = drive_pdf
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'firebase')
    response = client.get(PDF_ROUTE, headers={'If-None-Match': fixture['etag']})
    assert response.status_code == 401
    assert fixture['token_reads'] == 0
    assert fixture['media_reads'] == 0


@pytest.mark.parametrize(('change', 'expected_status'), [('revoked', 404), ('trashed', 404), ('blocked', 403), ('oversize', 413)])
def test_pdf_cache_validator_cannot_bypass_drive_checks(drive_pdf, change, expected_status):
    client, fixture = drive_pdf
    if change == 'revoked':
        fixture['metadata_status'] = 404
    elif change == 'trashed':
        fixture['payload']['trashed'] = True
    elif change == 'blocked':
        fixture['payload']['capabilities']['canDownload'] = False
    else:
        fixture['payload']['size'] = str(51 * 1024 * 1024)
    response = client.get(PDF_ROUTE, headers={'If-None-Match': fixture['etag']})
    assert response.status_code == expected_status
    assert fixture['media_reads'] == 0


def test_pdf_version_change_returns_new_bytes_and_validator(drive_pdf):
    client, fixture = drive_pdf
    fixture['body'] += b'new revision'
    checksum = hashlib.sha256(fixture['body']).hexdigest()
    fixture['payload'].update(sha256Checksum=checksum, size=str(len(fixture['body'])))
    response = client.get(PDF_ROUTE, headers={'If-None-Match': fixture['etag']})
    assert response.status_code == 200
    assert response.content == fixture['body']
    assert response.headers['etag'] == f'"sha256-{checksum}"'
    assert fixture['media_reads'] == 1


def test_pdf_without_checksum_remains_available_without_validator(drive_pdf):
    client, fixture = drive_pdf
    del fixture['payload']['sha256Checksum']
    response = client.get(PDF_ROUTE, headers={'If-None-Match': fixture['etag']})
    assert response.status_code == 200
    assert response.content == fixture['body']
    assert 'etag' not in response.headers


def test_pdf_edited_between_metadata_and_media_cannot_complete_under_old_validator(drive_pdf):
    client, fixture = drive_pdf
    fixture['body'] = fixture['body'][:-1] + b'Q'
    with pytest.raises(RuntimeError, match='Drive PDF changed during download'):
        client.get(PDF_ROUTE)
