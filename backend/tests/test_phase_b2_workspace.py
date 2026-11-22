"""Phase B2 structural constraints, concurrent edits and transaction rollback."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import importlib

import pytest
from fastapi.testclient import TestClient

from tests.helpers import create_course
from app.storage import SQLiteStore


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.delenv('VERCEL_ENV', raising=False)
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'workspace.sqlite3'))
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    import app.main as main
    importlib.reload(main)
    return TestClient(main.app)


def race(n, fn):
    gate = Barrier(n)

    def invoke(index):
        gate.wait()
        return fn(index)

    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(invoke, range(n)))


def test_semester_creation_is_unique_under_concurrency(client):
    response_codes = race(8, lambda i: client.post('/api/semesters', json={
        'name': ['Autumn 2027', ' autumn   2027 ', 'AUTUMN 2027'][i % 3],
    }).status_code)
    assert response_codes.count(201) == 1, response_codes
    assert response_codes.count(409) == 7, response_codes
    assert len(client.get('/api/snapshot').json()['semesters']) == 1


def test_course_code_uniqueness_under_concurrency_and_semester_moves(client):
    autumn = client.post('/api/semesters', json={'name': 'Autumn 2027'}).json()
    spring = client.post('/api/semesters', json={'name': 'Spring 2028'}).json()
    responses = race(7, lambda i: client.post('/api/courses', json={
        'code': ' 02516 ' if i % 2 else '02516', 'title': 'Vision', 'semester_id': autumn['id'],
    }).status_code)
    assert responses.count(201) == 1, responses
    assert responses.count(409) == 6, responses
    first = client.get('/api/snapshot').json()['courses'][0]
    second = create_course(client, {'code': '02516', 'title': 'Vision II', 'semester_id': spring['id']}).json()
    assert client.patch('/api/courses/' + second['id'], json={'semester_id': autumn['id']}).status_code == 409
    assert client.patch('/api/courses/' + second['id'], json={'semester_id': spring['id'], 'code': '02517'}).status_code == 200
    assert client.patch('/api/courses/' + second['id'], json={'semester_id': autumn['id']}).status_code == 200
    assert first['semester_id'] == autumn['id']
    assert client.get('/api/snapshot').json()['courses'][1]['semester_id'] == autumn['id']


def test_week_creation_is_unique_and_respects_course_length(client):
    course = create_course(client, {'code': '02516', 'title': 'Vision', 'week_count': 4}).json()
    codes = race(6, lambda i: client.post('/api/weeks', json={
        'course_id': course['id'], 'number': 2, 'title': 'Part ' + str(i),
    }).status_code)
    assert codes.count(201) == 1, codes
    assert codes.count(409) == 5, codes
    assert client.post('/api/weeks', json={'course_id': course['id'], 'number': 5,
                                            'title': 'Invalid'}).status_code == 422
    assert len(client.get('/api/snapshot').json()['weeks']) == 1


def test_semester_rename_updates_all_linked_courses_atomically(client):
    sem = client.post('/api/semesters', json={'name': 'Spring 2027'}).json()
    other = client.post('/api/semesters', json={'name': 'Autumn 2027'}).json()
    for n in range(3):
        create_course(client, {'code': f'0251{n}', 'title': str(n), 'semester_id': sem['id']})
    assert client.patch('/api/semesters/' + sem['id'], json={'name': other['name']}).status_code == 409
    assert client.patch('/api/semesters/' + sem['id'], json={'name': 'Spring term 2027'}).status_code == 200
    rows = client.get('/api/snapshot').json()
    assert all(c['semester'] == 'Spring term 2027' for c in rows['courses'])
    assert any(s['id'] == sem['id'] and s['name'] == 'Spring term 2027'
               for s in rows['semesters'])
    assert client.delete('/api/semesters/' + sem['id']).status_code == 409


def test_concurrent_course_and_week_field_updates_merge(client):
    sem = client.post('/api/semesters', json={'name': 'Spring 2027'}).json()
    course = create_course(client, {'code': '02516', 'title': 'Vision', 'semester_id': sem['id']}).json()
    week = client.post('/api/weeks', json={'course_id': course['id'], 'number': 1, 'title': 'Week'}).json()
    responses = race(2, lambda i: client.patch('/api/courses/' + course['id'], json=(
        {'title': 'Computer Vision'} if i == 0 else {'goals': 'Deep study'})).status_code)
    assert responses == [200, 200]
    course_latest = next(c for c in client.get('/api/snapshot').json()['courses'] if c['id'] == course['id'])
    assert course_latest['title'] == 'Computer Vision' and course_latest['goals'] == 'Deep study'
    responses = race(2, lambda i: client.patch('/api/weeks/' + week['id'], json=(
        {'title': 'Introduction'} if i == 0 else {'objectives': 'Learn features'})).status_code)
    assert responses == [200, 200]
    week_latest = client.get('/api/snapshot').json()['weeks'][0]
    assert week_latest['title'] == 'Introduction' and week_latest['objectives'] == 'Learn features'


def test_workspace_transaction_rollback_prevents_partial_rename(tmp_path):
    store = SQLiteStore(str(tmp_path / 'rollback.sqlite3'))
    store.create('alice', 'semesters', {'id': 'spring', 'name': 'Spring'})
    store.create('alice', 'courses', {'id': 'course', 'code': '02516', 'semester_id': 'spring', 'semester': 'Spring'})

    def partial(tx):
        sem = tx.get('semesters', 'spring')
        tx.put('semesters', {**sem, 'name': 'New name'})
        course = tx.get('courses', 'course')
        tx.put('courses', {**course, 'semester': 'New name'})
        raise RuntimeError('Injected interruption')

    with pytest.raises(RuntimeError, match='Injected interruption'):
        store.workspace_atomic('alice', partial)
    assert store.get('alice', 'semesters', 'spring')['name'] == 'Spring'
    assert store.get('alice', 'courses', 'course')['semester'] == 'Spring'


def test_semester_delete_and_course_create_cannot_leave_orphan(client):
    sem = client.post('/api/semesters', json={'name': 'Autumn 2028'}).json()
    statuses = race(2, lambda i: (client.delete('/api/semesters/' + sem['id']) if i == 0
                                   else client.post('/api/courses', json={'code': '02516',
                                         'title': 'Vision', 'semester_id': sem['id']})).status_code)
    assert statuses in ([204, 422], [409, 201]), statuses
    rows = client.get('/api/snapshot').json()
    assert not rows['courses'] or any(s['id'] == sem['id'] for s in rows['semesters'])


def test_concurrent_drive_resource_duplicates_are_rejected(client):
    c = create_course(client, {'code': '02516', 'title': 'Vision'}).json()
    results = race(5, lambda i: client.post('/api/resources', json={
        'course_id': c['id'], 'week_number': 1, 'title': 'Slides',
        'source': 'drive', 'drive_file_id': 'duplicate_file',
    }).status_code)
    assert results.count(201) == 1, results
    assert results.count(409) == 4, results


def test_resource_patch_merges_different_fields_without_losing_bookmark(client):
    c = create_course(client, {'code': '02516', 'title': 'Vision'}).json()
    r = client.post('/api/resources', json={'title': 'Slides', 'source': 'link',
        'url': 'https://example.com/slides.pdf', 'course_id': c['id'], 'week_number': 1}).json()
    results = race(2, lambda i: (client.patch('/api/resources/' + r['id'], json={'title': 'Lecture Slides'})
                                  if i == 0 else client.patch('/api/resources/' + r['id'],
                                                              json={'chapter': '2.3'})).status_code)
    assert results == [200, 200]
    latest = client.get('/api/snapshot').json()['resources'][0]
    assert latest['title'] == 'Lecture Slides' and latest['chapter'] == '2.3'


def test_bookmark_and_metadata_updates_do_not_clobber_each_other(client):
    course = create_course(client, {'code': '02516', 'title': 'Vision'}).json()
    resource = client.post('/api/resources', json={
        'title': 'Textbook', 'source': 'link', 'url': 'https://example.org/book.pdf',
        'course_id': course['id'], 'kind': 'textbook',
    }).json()
    statuses = race(2, lambda i: (client.patch(
        '/api/resources/' + resource['id'] + '/reading-position', json={'page': 73})
        if i == 0 else client.patch(
        '/api/resources/' + resource['id'], json={'title': 'Updated Textbook'})).status_code)
    assert statuses == [200, 200]
    stored = client.get('/api/snapshot').json()['resources'][0]
    assert stored['last_page'] == 73 and stored['title'] == 'Updated Textbook'


def test_resource_creation_and_item_deletion_remain_link_consistent(client):
    course = create_course(client, {'code': '02516', 'title': 'Vision'}).json()
    item = client.post('/api/items', json={'kind': 'lecture', 'title': 'Week 1',
        'course_id': course['id'], 'week_number': 1}).json()
    statuses = race(2, lambda i: (client.delete('/api/items/' + item['id'])
        if i == 0 else client.post('/api/resources', json={
            'title': 'Slides', 'source': 'link', 'url': 'https://example.com/slides.pdf',
            'course_id': course['id'], 'week_number': 1, 'item_id': item['id'],
        })).status_code)
    assert statuses in ([204, 404], [409, 201]), statuses
    rows = client.get('/api/snapshot').json()
    assert not rows['resources'] or any(i['id'] == item['id'] for i in rows['items'])


def test_archive_and_focus_start_cannot_leave_active_session_in_archived_course(client):
    course = create_course(client, {'code': '02516', 'title': 'Vision'}).json()
    statuses = race(2, lambda i: (client.post('/api/courses/' + course['id'] + '/archive')
        if i == 0 else client.post('/api/sessions/start', json={'course_id': course['id'], 'mode': '50'})).status_code)
    assert statuses in ([200, 409], [409, 201]), statuses
    rows = client.get('/api/snapshot').json()
    record = next(c for c in rows['courses'] if c['id'] == course['id'])
    assert not (record['archived'] and any(s['status'] in ('running', 'paused')
        and s.get('course_id') == course['id'] for s in rows['sessions']))
