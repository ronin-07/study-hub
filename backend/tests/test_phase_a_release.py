"""Release gate A — no destructive creates, registered semesters, isolated projects."""
import importlib
import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'phase_a.sqlite3'))
    import app.main as main
    importlib.reload(main)
    return TestClient(main.app)


def test_create_is_non_destructive_for_all_entities(client):
    semester = client.post('/api/semesters', json={'id':'sem1', 'name':'Autumn 2026'})
    assert semester.status_code == 201
    assert client.post('/api/semesters', json={'id':'sem1', 'name':'Different'}).status_code == 409
    course = {'id':'course1', 'code':'02516', 'title':'CV', 'semester_id':'sem1'}
    assert client.post('/api/courses', json=course).status_code == 201
    assert client.post('/api/courses', json={**course,'title':'Should not overwrite'}).status_code == 409
    assert client.post('/api/weeks', json={'id':'w1','course_id':'course1','number':1,'title':'One'}).status_code == 201
    assert client.post('/api/weeks', json={'id':'w1','course_id':'course1','number':2,'title':'Overwrite attempt'}).status_code == 409
    assert client.post('/api/items', json={'id':'i1','title':'Original','kind':'notes','course_id':'course1','week_number':1}).status_code == 201
    assert client.post('/api/items', json={'id':'i1','title':'Overwrite attempt','kind':'personal'}).status_code == 409
    resource = {'id':'r1','course_id':'course1','title':'Slides','source':'link','url':'https://example.com/slides.pdf'}
    assert client.post('/api/resources', json=resource).status_code == 201
    assert client.post('/api/resources', json={**resource,'title':'Overwrite attempt'}).status_code == 409
    snapshot = client.get('/api/snapshot').json()
    assert snapshot['courses'][0]['title'] == 'CV'
    assert snapshot['weeks'][0]['title'] == 'One'
    assert snapshot['items'][0]['title'] == 'Original'
    assert snapshot['resources'][0]['title'] == 'Slides'
    assert snapshot['semesters'][0]['name'] == 'Autumn 2026'


def test_courses_require_valid_registered_semesters_and_unique_codes(client):
    assert client.post('/api/courses',json={'code':'02516','title':'Orphan'}).status_code == 422
    assert client.post('/api/courses',json={'code':'02516','title':'Orphan','semester_id':'unknown'}).status_code == 422
    s1 = client.post('/api/semesters',json={'name':'Spring 2027'}).json()['id']
    s2 = client.post('/api/semesters',json={'name':'Autumn 2027'}).json()['id']
    first = client.post('/api/courses',json={'code':'02516','title':'CV','semester_id':s1,'semester':'Spoofed label'})
    assert first.status_code == 201
    assert first.json()['semester'] == 'Spring 2027'
    assert client.post('/api/courses',json={'code':' 02516 ','title':'Duplicate','semester_id':s1}).status_code == 409
    assert client.post('/api/courses',json={'code':'02516','title':'Other semester','semester_id':s2}).status_code == 201
    assert client.post('/api/courses',json={'code':'02452','title':'HPC','semester_id':s1}).status_code == 201
    hp = next(c for c in client.get('/api/snapshot').json()['courses'] if c['code']=='02452')
    assert client.patch('/api/courses/'+hp['id'],json={'code':'02516'}).status_code == 409
    assert client.patch('/api/courses/'+hp['id'],json={'semester_id':None}).status_code == 422
    assert client.patch('/api/courses/'+hp['id'],json={'semester':'Fake name'}).json()['semester'] == 'Spring 2027'


def test_hosted_project_selection_fails_closed(monkeypatch):
    from app.deployment import validate_deployment_environment
    values = {
        'VERCEL':'1','VERCEL_ENV':'production',
        'STUDY_HUB_AUTH_MODE':'firebase','STORAGE_BACKEND':'firestore',
        'STUDY_HUB_ALLOWED_EMAIL':'user@example.com',
        'STUDY_HUB_PREVIEW_FIREBASE_PROJECT_ID':'preview-id',
        'STUDY_HUB_PRODUCTION_FIREBASE_PROJECT_ID':'production-id',
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID':'production-id',
        'FIREBASE_SERVICE_ACCOUNT_JSON':json.dumps({'project_id':'production-id'}),
    }
    for k,v in values.items(): monkeypatch.setenv(k,v)
    validate_deployment_environment()
    monkeypatch.setenv('FIREBASE_SERVICE_ACCOUNT_JSON',json.dumps({'project_id':'preview-id'}))
    with pytest.raises(RuntimeError,match='does not match'):
        validate_deployment_environment()
    monkeypatch.setenv('FIREBASE_SERVICE_ACCOUNT_JSON',json.dumps({'project_id':'production-id'}))
    monkeypatch.setenv('NEXT_PUBLIC_FIREBASE_PROJECT_ID','preview-id')
    with pytest.raises(RuntimeError,match='Web Firebase project'):
        validate_deployment_environment()
    monkeypatch.setenv('NEXT_PUBLIC_FIREBASE_PROJECT_ID','production-id')
    monkeypatch.setenv('STUDY_HUB_PREVIEW_FIREBASE_PROJECT_ID','production-id')
    with pytest.raises(RuntimeError,match='distinct'):
        validate_deployment_environment()
    monkeypatch.setenv('STUDY_HUB_PREVIEW_FIREBASE_PROJECT_ID','preview-id')
    monkeypatch.setenv('VERCEL_ENV','unexpected')
    with pytest.raises(RuntimeError,match='Unknown hosted environment'):
        validate_deployment_environment()


@pytest.mark.parametrize(
    'relative_path',
    ('backend/.env.example', 'backend/.env.preview.example', 'web/.env.local.example'),
)
def test_environment_examples_are_sanitized_or_intentionally_ignored(relative_path):
    """Untracked env examples may be absent in CI; that is not a security failure.

    If an example exists, it must contain placeholders only. If the user has
    removed it from Git, do not assume it will exist after actions/checkout.
    """
    root = Path(__file__).resolve().parents[2]
    path = root / relative_path
    if path.is_file():
        content = path.read_text(encoding='utf-8')
        assert 'BEGIN PRIVATE KEY' not in content, f'{relative_path} contains a private key'
        assert 'private_key_id' not in content, f'{relative_path} contains a private key ID'
        assert 'FIREBASE_SERVICE_ACCOUNT_JSON={' not in content, f'{relative_path} embeds service-account JSON'
        return

    # A missing example is valid when it has been deliberately removed from
    # version control. GitHub Actions only checks out tracked files. The CI
    # credential scanner independently checks *all* tracked source files.
    result = subprocess.run(
        ['git', 'ls-files', '--', relative_path],
        cwd=root, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, f'Unable to check Git tracking for {relative_path}'
    assert not result.stdout.strip(), (
        f'{relative_path} is Git-tracked but missing from the working tree.'
    )


def test_firestore_create_uses_non_overwriting_precondition():
    exceptions = pytest.importorskip('google.api_core.exceptions', reason='Firestore SDK is not installed locally')
    Conflict = exceptions.Conflict
    from app.storage import DocumentAlreadyExists, FirestoreStore

    class Reference:
        def __init__(self, collision=False):
            self.collision = collision
            self.created = []
        def create(self, doc):
            if self.collision:
                raise Conflict('document already exists')
            self.created.append(doc)
        def set(self, doc):
            raise AssertionError('create must not use a blind .set()')

    class Collection:
        def __init__(self, ref): self.ref = ref
        def document(self, identifier):
            assert identifier == 'known-id'
            return self.ref

    store = FirestoreStore.__new__(FirestoreStore)
    ok = Reference()
    store.col = lambda uid, kind: Collection(ok)
    payload = {'id': 'known-id', 'title': 'Safe create'}
    store.create('user', 'items', payload)
    assert ok.created == [payload]
    store.col = lambda uid, kind: Collection(Reference(collision=True))
    with pytest.raises(DocumentAlreadyExists):
        store.create('user', 'items', payload)
