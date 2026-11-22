"""v0.4 compatibility and safety regressions. Does not access production Firestore."""
import importlib
import json
import os
import time
import hashlib
from urllib.parse import urlparse, parse_qs

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.delenv('VERCEL_ENV', raising=False)
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'studyhub.sqlite'))
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    import app.main as main
    import app.drive as drive
    importlib.reload(main)
    importlib.reload(drive)
    return TestClient(main.app)


def course(client, weeks=13):
    res = client.post('/api/courses', json={'code': '02516', 'title': 'Image Analysis', 'week_count': weeks})
    assert res.status_code == 201, res.text
    return res.json()


def test_legacy_course_is_compatible_and_snapshot_has_semesters(client):
    c = course(client)
    snap = client.get('/api/snapshot').json()
    assert snap['semesters'] == []
    assert c['semester'] == 'Autumn 2026'
    assert c['semester_id'] is None
    assert c['exam_date'] is None
    assert c['goals'] == ''


def test_semester_course_edit_and_safe_delete(client):
    sem = client.post('/api/semesters', json={'name': 'Spring 2027', 'start_date': '2027-02-01'}).json()
    assert client.post('/api/semesters', json={'name': 'spring 2027'}).status_code == 409
    c = course(client, weeks=10)
    edited = client.patch('/api/courses/'+c['id'], json={'semester_id': sem['id'], 'exam_date': '2027-05-19', 'goals': 'Prepare all 10 weeks'}).json()
    assert edited['semester'] == 'Spring 2027'
    assert edited['exam_date'] == '2027-05-19'
    assert client.delete('/api/semesters/'+sem['id']).status_code == 409
    assert client.post('/api/courses/'+c['id']+'/archive').status_code == 200
    assert client.delete('/api/courses/'+c['id']).status_code == 405
    assert client.delete('/api/semesters/'+sem['id']).status_code == 409


def test_semester_validation_and_edit(client):
    assert client.post('/api/semesters', json={'name':'Wrong dates','start_date':'2027-05-01','end_date':'2027-04-01'}).status_code == 422
    sem = client.post('/api/semesters', json={'name': 'Autumn 2027'}).json()
    edited = client.patch('/api/semesters/'+sem['id'], json={'name':'Fall 2027'}).json()
    assert edited['name'] == 'Fall 2027'


def test_cannot_shrink_course_or_delete_course_with_records(client):
    c = course(client)
    week = client.post('/api/weeks', json={'course_id':c['id'], 'number':11, 'title':'Review'}).json()
    assert client.patch('/api/courses/'+c['id'], json={'week_count':10}).status_code == 409
    assert client.delete('/api/courses/'+c['id']).status_code == 405
    edited = client.patch('/api/weeks/'+week['id'], json={'title':'Refined topic', 'objectives':'Read textbook'}).json()
    assert edited['title']=='Refined topic'
    assert edited['number']==11


def test_multiple_resources_to_same_lecture_and_reading_chapter(client):
    c=course(client)
    item=client.post('/api/items', json={'title':'Lecture 10', 'course_id':c['id'], 'week_number':10, 'kind':'lecture'}).json()
    reading=client.post('/api/items', json={'title':'Chapter 6','kind':'reading','course_id':c['id'],'week_number':10,
        'chapter':'6.2','page_start':103,'page_end':125,'planned_date':'2026-11-24'}).json()
    assert reading['is_task'] is True
    assert reading['page_end']==125
    files=[]
    for kind in ('slides','annotated','handwritten'):
        r=client.post('/api/resources',json={'title':kind,'course_id':c['id'],'week_number':10,'kind':kind,
            'source':'drive','drive_file_id':'example_'+kind,'item_id':item['id']})
        assert r.status_code==201, r.text
        files.append(r.json())
    assert len([r for r in client.get('/api/snapshot').json()['resources'] if r['item_id']==item['id']])==3
    assert client.patch('/api/resources/'+files[0]['id'], json={'item_id':reading['id'],'chapter':'6.2','page_start':103,'page_end':125}).status_code==200
    assert client.patch('/api/resources/'+files[0]['id'], json={'page_start':125,'page_end':103}).status_code==422
    assert client.delete('/api/courses/'+c['id']).status_code == 405


def test_cross_week_resource_reassignment_is_denied(client):
    c=course(client)
    first=client.post('/api/items',json={'title':'First','kind':'lecture','course_id':c['id'],'week_number':1}).json()
    second=client.post('/api/items',json={'title':'Second','kind':'lecture','course_id':c['id'],'week_number':2}).json()
    r=client.post('/api/resources',json={'title':'PDF','source':'link','url':'https://example.com/slides.pdf','course_id':c['id'],'week_number':1,'item_id':first['id']}).json()
    assert client.patch('/api/resources/'+r['id'],json={'item_id':second['id']}).status_code==422
    assert client.patch('/api/resources/'+r['id'],json={'item_id':None}).status_code==200
    assert client.patch('/api/resources/'+r['id'],json={'source':'drive'}).status_code==422  # immutable location


def test_preview_deployment_must_be_isolated(monkeypatch):
    from app.deployment import validate_deployment_environment, require_drive_available
    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.setenv('VERCEL_ENV','preview')
    monkeypatch.setenv('STORAGE_BACKEND','firestore')
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE','firebase')
    monkeypatch.setenv('STUDY_HUB_ALLOWED_EMAIL','user@example.com')
    monkeypatch.setenv('FIREBASE_SERVICE_ACCOUNT_JSON', json.dumps({'project_id':'prod-project'}))
    monkeypatch.setenv('STUDY_HUB_PREVIEW_FIREBASE_PROJECT_ID','preview-project')
    monkeypatch.setenv('STUDY_HUB_PRODUCTION_FIREBASE_PROJECT_ID','prod-project')
    with pytest.raises(RuntimeError, match='distinct'):
        validate_deployment_environment()
    monkeypatch.setenv('FIREBASE_SERVICE_ACCOUNT_JSON', json.dumps({'project_id':'preview-project'}))
    validate_deployment_environment()
    with pytest.raises(Exception, match='disabled'):
        require_drive_available()


def test_oauth_state_is_single_use(client, monkeypatch):
    import app.drive as drive
    from cryptography.fernet import Fernet
    monkeypatch.setenv('GOOGLE_CLIENT_ID','example-client')
    monkeypatch.setenv('GOOGLE_CLIENT_SECRET','test-client-secret')
    monkeypatch.setenv('GOOGLE_REDIRECT_URI','http://localhost:8000/api/drive/callback')
    monkeypatch.setenv('APP_SIGNING_SECRET','signing-secret-long-value')
    monkeypatch.setenv('OAUTH_ENCRYPTION_KEY',Fernet.generate_key().decode())
    authorization=client.get('/api/drive/connect')
    assert authorization.status_code==200
    url=authorization.json()['authorization_url']
    state=parse_qs(urlparse(url).query)['state'][0]
    identifier=hashlib.sha256(state.encode()).hexdigest()
    assert drive._store().get('local-owner','oauth-challenges',identifier)
    # Reaching callback with a bad code consumes challenge before contacting Google
    class BrokenClient:
        async def __aenter__(self): return self
        async def __aexit__(self,*args): return None
        async def post(self,*args,**kwargs):
            class Response:
                status_code=400
            return Response()
    monkeypatch.setattr(drive.httpx,'AsyncClient',lambda **kwargs:BrokenClient())
    first=client.get('/api/drive/callback',params={'code':'invalid-code','state':state},follow_redirects=False)
    assert first.status_code==400
    second=client.get('/api/drive/callback',params={'code':'invalid-code','state':state},follow_redirects=False)
    assert second.status_code==400
    assert 'already used' in second.json()['detail']
    assert drive._store().get('local-owner','oauth-challenges',identifier) is None


def test_renaming_semester_updates_linked_course(client):
    sem=client.post('/api/semesters',json={'name':'Spring 2027'}).json()
    c=client.post('/api/courses',json={'code':'02501','title':'Studies','semester_id':sem['id']}).json()
    assert c['semester']=='Spring 2027'
    assert client.patch('/api/semesters/'+sem['id'],json={'name':'Spring term 2027'}).status_code==200
    course_from_snapshot=next(row for row in client.get('/api/snapshot').json()['courses'] if row['id']==c['id'])
    assert course_from_snapshot['semester']=='Spring term 2027'


def test_cannot_delete_item_with_linked_pdf(client):
    c=course(client)
    item=client.post('/api/items',json={'title':'Lecture','kind':'lecture','course_id':c['id'],'week_number':1}).json()
    r=client.post('/api/resources',json={'title':'Slide','source':'link','url':'https://example.com/lecture.pdf',
      'course_id':c['id'],'week_number':1,'item_id':item['id']}).json()
    assert client.delete('/api/items/'+item['id']).status_code==409
    assert client.delete('/api/resources/'+r['id']).status_code==204
    assert client.delete('/api/items/'+item['id']).status_code==204


def test_focus_inherits_task_context_when_not_explicitly_selected(client):
    c=course(client)
    item=client.post('/api/items',json={'title':'Revision','kind':'revision','course_id':c['id'],'week_number':8,'is_task':True}).json()
    session=client.post('/api/sessions/start',json={'item_id':item['id'],'mode':'25'}).json()
    assert session['course_id']==c['id']
    assert session['week_number']==8


def test_user_scoped_data_cannot_be_edited_across_users(client):
    from app.security import User, current_user
    client.app.dependency_overrides[current_user] = lambda: User('owner-a')
    try:
        c=course(client)
        client.app.dependency_overrides[current_user] = lambda: User('owner-b')
        assert client.get('/api/snapshot').json()['courses']==[]
        assert client.patch('/api/courses/'+c['id'],json={'title':'Intruder'}).status_code==404
        assert client.delete('/api/courses/'+c['id']).status_code==404
    finally:
        client.app.dependency_overrides.clear()


def test_oauth_credentials_are_encrypted_at_rest(client, monkeypatch):
    import app.drive as drive
    from cryptography.fernet import Fernet
    key=Fernet.generate_key().decode()
    cfg={'OAUTH_ENCRYPTION_KEY':key}
    drive._save_token(drive._store(),'local-owner',cfg,{'access_token':'sensitive-access-token','refresh_token':'sensitive-refresh-token'})
    record=drive._store().get('local-owner','secrets','drive-token')
    assert 'sensitive-access-token' not in record['blob']
    assert 'sensitive-refresh-token' not in record['blob']
    assert drive._token(drive._store(),'local-owner',cfg)['refresh_token']=='sensitive-refresh-token'
