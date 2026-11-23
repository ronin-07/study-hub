"""v0.5.1 safe activity editing, separate task visibility, and past-exam library kinds."""
import importlib

import pytest
from fastapi.testclient import TestClient
from tests.helpers import create_course


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'v051.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    import app.main as main
    importlib.reload(main)
    return TestClient(main.app)


def test_hide_week_task_preserves_progress_dates_and_links_and_can_restore(client):
    course = create_course(client, {'code':'02516','title':'Deep learning'}).json()
    book = client.post('/api/resources', json={
        'course_id':course['id'],'title':'Reference PDF','kind':'textbook',
        'source':'link','url':'https://example.org/textbook.pdf'}).json()
    item = client.post('/api/items', json={
        'title':'Read chapters', 'course_id':course['id'], 'week_number':1, 'kind':'reading',
        'chapter':'3.5, 3.11, 4.1', 'resource_id':book['id'], 'is_task':True,
        'planned_date':'2026-11-23','due_date':'2026-12-01'}).json()
    url = '/api/items/' + item['id']
    hidden = client.patch(url, json={'hidden_from_tasks':True})
    assert hidden.status_code == 200, hidden.text
    row = hidden.json()
    assert row['hidden_from_tasks'] is True
    assert row['is_task'] is True  # Existing task semantics preserved for backwards compatibility.
    assert row['week_number'] == 1
    assert row['planned_date'] == '2026-11-23'
    assert row['due_date'] == '2026-12-01'
    assert row['chapter'] == '3.5, 3.11, 4.1'
    assert row['resource_id'] == book['id']
    edited = client.patch(url, json={'title':'Read sections','chapter':'3.5, 3.11', 'kind':'notes',
                                      'page_start':2,'page_end':21, 'notes':'My notes'})
    assert edited.status_code == 200, edited.text
    assert edited.json()['kind'] == 'notes'
    assert edited.json()['hidden_from_tasks'] is True
    done = client.patch(url, json={'done':True}).json()
    assert done['done'] is True
    assert len(client.get('/api/snapshot').json()['items']) == 1
    visible = client.patch(url, json={'hidden_from_tasks':False})
    assert visible.status_code == 200
    assert visible.json()['done'] is True
    assert visible.json()['hidden_from_tasks'] is False


def test_exam_papers_and_solutions_are_shared_and_editable(client):
    course = create_course(client, {'code':'02456','title':'Deep learning'}).json()
    for kind in ['exam_paper','exam_solution']:
        res = client.post('/api/resources',json={'course_id':course['id'], 'kind':kind,
                 'title':f'2025 {kind}', 'source':'link','url':f'https://example.org/{kind}.pdf'})
        assert res.status_code == 201, res.text
        row = res.json()
        assert row['week_number'] is None
        updated=client.patch('/api/resources/'+row['id'],json={'title':f'2024 {kind}', 'kind':kind})
        assert updated.status_code == 200, updated.text
        assert updated.json()['title'] == f'2024 {kind}'
    snap = client.get('/api/snapshot').json()
    assert {r['kind'] for r in snap['resources']} == {'exam_paper','exam_solution'}


def test_cannot_hide_a_personal_task_without_a_weekly_home(client):
    personal = client.post('/api/items', json={'title':'Buy stationery','kind':'personal'}).json()
    response = client.patch('/api/items/'+personal['id'], json={'hidden_from_tasks':True})
    assert response.status_code == 422
    unchanged = next(i for i in client.get('/api/snapshot').json()['items'] if i['id']==personal['id'])
    assert unchanged['hidden_from_tasks'] is False


def test_questions_kind_creates_edits_and_roundtrips_reference_numbers(client):
    course = create_course(client, {'code':'02456','title':'Deep learning'}).json()
    item = client.post('/api/items', json={
        'course_id':course['id'], 'week_number':1, 'kind':'questions',
        'title':'Exam questions', 'chapter':'3,4,5.6,4.2.1', 'is_task':False,
    })
    assert item.status_code == 201, item.text
    row = item.json()
    assert row['kind'] == 'questions'
    assert row['chapter'] == '3,4,5.6,4.2.1'  # Stored text is not reformatted.
    assert row['is_task'] is False
    changed = client.patch('/api/items/'+row['id'], json={
        'chapter':'3, 4, 5.6, 4.2.1', 'is_task':True,
    })
    assert changed.status_code == 200, changed.text
    assert changed.json()['kind'] == 'questions'
    assert changed.json()['is_task'] is True
    saved = next(i for i in client.get('/api/snapshot').json()['items'] if i['id'] == row['id'])
    assert saved['chapter'] == '3, 4, 5.6, 4.2.1'
    assert saved['kind'] == 'questions'


def test_existing_reading_kind_remains_valid_after_adding_questions(client):
    course = create_course(client, {'code':'02516','title':'Computer Vision'}).json()
    reading = client.post('/api/items', json={
        'course_id':course['id'], 'week_number':1, 'kind':'reading',
        'title':'Reading', 'chapter':'3.1,4.2',
    })
    assert reading.status_code == 201, reading.text
    assert reading.json()['kind'] == 'reading'
    changed = client.patch('/api/items/'+reading.json()['id'], json={'kind':'questions'})
    assert changed.status_code == 200, changed.text
    assert changed.json()['chapter'] == '3.1,4.2'
