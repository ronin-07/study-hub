"""Smoke tests for production fail-closed configuration."""

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


def test_pdf_preview_uses_streaming_response(monkeypatch, tmp_path):
    """Streaming route returns PDF bytes without requiring live Google access."""
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
        def __init__(self, payload=None, body=b''):
            self.status_code = 200
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

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def get(self, *_args, **_kwargs):
            return FakeResponse({'mimeType': 'application/pdf', 'size': str(len(expected))})

        def build_request(self, method, url, **kwargs):
            return (method, url, kwargs)

        async def send(self, *_args, **_kwargs):
            return FakeResponse(body=expected)

        async def aclose(self):
            pass

    async def fake_token(*_):
        return 'test-token'

    monkeypatch.setattr(drive, 'access_token', fake_token)
    monkeypatch.setattr(drive.httpx, 'AsyncClient', FakeClient)
    response = TestClient(main.app).get('/api/drive/files/knownDrivePdf123/pdf')
    assert response.status_code == 200
    assert response.content == expected
    assert response.headers['content-type'].startswith('application/pdf')
    assert response.headers['cache-control'] == 'private, no-store'
