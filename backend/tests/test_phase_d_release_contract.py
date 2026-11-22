"""Final low-cost release guards; live Firebase and browser tests remain separate."""
import importlib
from pathlib import Path

from fastapi.testclient import TestClient


def test_firestore_rules_deny_direct_client_reads_and_writes():
    rules = (Path(__file__).resolve().parents[2] / 'docs' / 'firestore.rules').read_text()
    assert 'rules_version' in rules
    assert 'allow read, write: if false;' in rules
    assert 'if true' not in rules
    assert 'request.auth' not in rules  # Server-only access; no user browser SDK reads.


def test_authenticated_api_responses_are_private_and_not_sniffable(monkeypatch, tmp_path):
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'release-d.sqlite3'))
    from app import main
    importlib.reload(main)
    with TestClient(main.app) as client:
        for path in ['/api/snapshot', '/api/items', '/api/drive/status']:
            response = client.get(path)
            assert response.status_code == 200, (path, response.text)
            assert response.headers['cache-control'] == 'private, no-store'
            assert response.headers['x-content-type-options'] == 'nosniff'
