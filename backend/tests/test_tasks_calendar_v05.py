"""v0.5 regression tests for shared task state, recurrence and scheduling."""
from datetime import date
import importlib
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path / 'tasks.sqlite3'))
    monkeypatch.setenv('STUDY_HUB_AUTH_MODE', 'local')
    monkeypatch.setenv('STORAGE_BACKEND', 'sqlite')
    import app.main as main
    importlib.reload(main)
    return TestClient(main.app)


def test_recurrence_generates_next_occurrence_once_and_keeps_due_offset(client):
    item = client.post('/api/items', json={
        'title':'Review lecture notes','kind':'personal','planned_date':'2026-11-23',
        'due_date':'2026-11-25','repeat':'weekly'
    }).json()
    url = '/api/items/' + item['id']
    assert client.patch(url, json={'done':True}).status_code == 200
    records = client.get('/api/snapshot').json()['items']
    next_task = next(i for i in records if i['id'] != item['id'])
    assert next_task['planned_date'] == '2026-11-30'
    assert next_task['due_date'] == '2026-12-02'
    assert next_task['repeat'] == 'weekly'
    assert next_task['done'] is False
    # Duplicate PATCH and later re-completion cannot generate duplicate occurrences.
    client.patch(url, json={'done':True})
    client.patch(url, json={'done':False})
    client.patch(url, json={'done':True})
    assert len(client.get('/api/snapshot').json()['items']) == 2


def test_recurrence_validation_and_assignment_safety(client):
    assert client.post('/api/items', json={'title':'No date','kind':'personal','repeat':'daily'}).status_code == 422
    assert client.post('/api/items', json={'title':'Exam report','kind':'assignment','planned_date':'2026-11-23','repeat':'weekly'}).status_code == 422
    row = client.post('/api/items', json={'title':'Daily reading','kind':'personal','planned_date':'2026-11-23'}).json()
    assert client.patch('/api/items/'+row['id'], json={'repeat':'daily'}).status_code == 200
    assert client.patch('/api/items/'+row['id'], json={'planned_date': None}).status_code == 422


def test_monthly_recurrence_from_last_day_of_month(client):
    from app.recurrence import next_date
    assert next_date(date(2027, 1, 31), 'monthly') == date(2027, 2, 28)
    assert next_date(date(2028, 1, 31), 'monthly') == date(2028, 2, 29)
    assert next_date(date(2027, 12, 31), 'monthly') == date(2028, 1, 31)


def test_editing_plan_preserves_due_date_and_course_context(client):
    course=client.post('/api/courses', json={'code':'02516','title':'CV'}).json()
    task=client.post('/api/items',json={'title':'Revise','kind':'revision','course_id':course['id'],
        'week_number':4,'planned_date':'2026-11-23','due_date':'2026-11-30'}).json()
    result=client.patch('/api/items/'+task['id'],json={'planned_date':'2026-11-25'}).json()
    assert result['planned_date']=='2026-11-25'
    assert result['due_date']=='2026-11-30'
    assert result['course_id']==course['id']
    assert result['week_number']==4
