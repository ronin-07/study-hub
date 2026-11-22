"""v0.4.1: archive/restore and shared Course Library (SQLite only)."""
from tests.helpers import create_course
import importlib
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.delenv('VERCEL_ENV', raising=False)
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'test.sqlite'))
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    import app.main as main
    importlib.reload(main)
    return TestClient(main.app)


def course(client, semester=None):
    payload = {'code': '02516', 'title': 'Image analysis', 'semester': 'Autumn 2026'}
    if semester: payload['semester_id'] = semester
    resp = create_course(client, payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_archive_preserves_history_and_restore(client):
    c = course(client)
    i = client.post('/api/items', json={'title': 'Revise Lecture 10', 'kind':'revision',
        'course_id': c['id'], 'week_number':10, 'is_task':True}).json()
    r = client.post('/api/resources', json={'course_id':c['id'], 'week_number':10,
        'title':'Week 10 slides', 'source':'link', 'url':'https://example.org/slides.pdf'}).json()
    assert client.post(f"/api/courses/{c['id']}/archive").status_code == 200
    assert client.patch(f"/api/items/{i['id']}", json={'done': True}).status_code == 409
    assert client.patch(f"/api/courses/{c['id']}", json={'title':'should fail'}).status_code == 409
    assert client.post('/api/items',json={'title':'New','kind':'revision','course_id':c['id']}).status_code == 409
    assert client.post('/api/sessions/start',json={'course_id':c['id']}).status_code == 409
    assert client.delete(f"/api/courses/{c['id']}").status_code == 405
    snapshot = client.get('/api/snapshot').json()
    assert next(x for x in snapshot['courses'] if x['id']==c['id'])['archived'] is True
    assert any(x['id']==r['id'] for x in snapshot['resources'])
    assert any(x['id']==i['id'] for x in snapshot['items'])
    assert client.post(f"/api/courses/{c['id']}/restore").status_code == 200
    assert client.patch(f"/api/items/{i['id']}",json={'done':True}).status_code == 200


def test_archive_active_session_requires_finishing_first(client, monkeypatch):
    import app.main as main
    clock = [1000]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    c=course(client)
    session=client.post('/api/sessions/start',json={'course_id':c['id']}).json()
    assert client.post(f"/api/courses/{c['id']}/archive").status_code==409
    clock[0] += 5  # Completed Focus sessions require positive study time.
    assert client.post(f"/api/sessions/{session['id']}/finish",json={}).status_code==200
    assert client.post(f"/api/courses/{c['id']}/archive").status_code==200
    snap=client.get('/api/snapshot').json()
    assert len(snap['sessions'])==1


def test_shared_book_reused_across_weeks_without_duplicate_resource(client):
    c=course(client)
    shared=client.post('/api/resources',json={'course_id':c['id'], 'week_number':None,
      'kind':'textbook','title':'Course book','source':'drive',
      'drive_file_id':'book_12345'}).json()
    assert shared['week_number'] is None
    notes=client.post('/api/resources',json={'course_id':c['id'],
      'kind':'handwritten','title':'Whole-course notes','source':'link',
      'url':'https://example.org/course-notes.pdf'}).json()
    assert notes['week_number'] is None
    for week in (3, 7, 10):
        item=client.post('/api/items',json={'title':f'Read for week {week}',
          'course_id':c['id'],'week_number':week,'kind':'reading',
          'resource_id':shared['id'], 'page_start':week*10,'page_end':week*10+15})
        assert item.status_code==201, item.text
    snap=client.get('/api/snapshot').json()
    assert len([r for r in snap['resources'] if r['kind']=='textbook'])==1
    assert len([i for i in snap['items'] if i.get('resource_id')==shared['id']])==3
    assert client.delete('/api/resources/'+shared['id']).status_code==409
    assert client.patch('/api/resources/'+shared['id'],json={'week_number':3}).status_code==409
    assert client.patch('/api/resources/'+notes['id'],json={'week_number':7}).status_code==200


def test_weekly_pdf_stays_week_scoped_and_cannot_be_attached_to_other_week(client):
    c=course(client)
    r=client.post('/api/resources',json={'course_id':c['id'],'week_number':5,
      'title':'Slides','source':'link','url':'https://example.org/l5.pdf'}).json()
    bad=client.post('/api/items',json={'title':'Use slides','kind':'reading',
      'course_id':c['id'],'week_number':6,'resource_id':r['id']})
    assert bad.status_code==422
    good=client.post('/api/items',json={'title':'Use slides','kind':'reading',
      'course_id':c['id'],'week_number':5,'resource_id':r['id']})
    assert good.status_code==201
    assert client.patch('/api/items/'+good.json()['id'],json={'resource_id':None}).status_code==200


def test_legacy_weekly_resources_are_untouched(client):
    c=course(client)
    r=client.post('/api/resources',json={'course_id':c['id'],'week_number':1,
      'title':'Old notes','source':'link','url':'https://example.org/old.pdf'}).json()
    assert r['week_number']==1
    updated=client.patch('/api/resources/'+r['id'],json={'week_number':None})
    assert updated.status_code==200
    assert updated.json()['week_number'] is None


def test_semester_names_and_archive_course_are_user_scoped(client):
    from app.security import User, current_user
    client.app.dependency_overrides[current_user]=lambda:User('one')
    c=course(client)
    try:
        client.app.dependency_overrides[current_user]=lambda:User('two')
        assert client.post('/api/courses/'+c['id']+'/archive').status_code==404
        assert client.post('/api/courses/'+c['id']+'/restore').status_code==404
    finally:
        client.app.dependency_overrides.clear()


def test_registered_semester_rename_keeps_course_label_in_sync(client):
    c=course(client)
    sem=client.get('/api/snapshot').json()['semesters'][0]
    assert client.post('/api/semesters', json={'name':'Autumn 2026'}).status_code == 409
    linked=next(x for x in client.get('/api/snapshot').json()['courses'] if x['id']==c['id'])
    assert linked['semester_id']==sem['id']
    assert client.patch('/api/semesters/'+sem['id'],json={'name':'Fall 2026'}).status_code==200
    after=next(x for x in client.get('/api/snapshot').json()['courses'] if x['id']==c['id'])
    assert after['semester']=='Fall 2026'
    assert after['semester_id']==sem['id']


def test_archived_focus_history_cannot_be_deleted_until_restored(client, monkeypatch):
    import app.main as main
    clock = [1000]
    monkeypatch.setattr(main, 'now_s', lambda: clock[0])
    c=course(client)
    session=client.post('/api/sessions/start',json={'course_id':c['id']}).json()
    clock[0] += 5  # Test real completed history, not an empty session.
    assert client.post('/api/sessions/'+session['id']+'/finish',json={}).status_code==200
    assert client.post('/api/courses/'+c['id']+'/archive').status_code==200
    assert client.delete('/api/sessions/'+session['id']).status_code==409
    assert client.post('/api/courses/'+c['id']+'/restore').status_code==200
    assert client.delete('/api/sessions/'+session['id']).status_code==204


def test_shared_drive_file_is_not_duplicated_as_weekly_link(client):
    c=course(client)
    base={'course_id':c['id'],'title':'Shared book','source':'drive','drive_file_id':'same_file_1234'}
    shared=client.post('/api/resources',json={**base,'week_number':None,'kind':'textbook'})
    assert shared.status_code==201
    weekly=client.post('/api/resources',json={**base,'week_number':4,'kind':'textbook'})
    assert weekly.status_code==409
    other=client.post('/api/resources',json={'course_id':c['id'],'week_number':4,
        'title':'Notes','source':'drive','drive_file_id':'notes_file_1234'})
    assert other.status_code==201
    assert client.patch('/api/resources/'+other.json()['id'],json={'week_number':None}).status_code==200
