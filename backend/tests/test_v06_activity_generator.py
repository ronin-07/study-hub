from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from tests.test_phase_b2_workspace import client
from tests.helpers import create_course
from app.storage import WorkspaceView

DEFAULTS = [dict(title=title, kind=kind) for title,kind in [
    ('Lecture slides','lecture'), ('Book reading','reading'), ('Book questions','questions'),
    ('Past year questions','questions'), ('Assignments','assignment'), ('Exercises','exercise'),
]]


def course(client, code='02516', weeks=13):
    response = create_course(client, {'code':code,'title':'Vision','week_count':weeks})
    assert response.status_code == 201
    return response.json()['id']


def generate(client, course_id, activities=DEFAULTS, weeks=None):
    return client.post(f'/api/courses/{course_id}/generate-activities', json={
        'activities':activities, 'weeks': list(range(1,14)) if weeks is None else weeks})


def test_all_defaults_and_retry(client):
    cid = course(client)
    result = generate(client,cid).json()
    assert (result['created'],result['skipped']) == (78,0)
    assert len(result['items']) == 78
    assert all(not i['done'] and not i['submitted'] and i['planned_date'] is None and i['due_date'] is None for i in result['items'])
    assert all(i['is_task'] == (i['kind']=='assignment') for i in result['items'])
    retry = generate(client,cid).json()
    assert (retry['created'],retry['skipped']) == (0,78)
    assert {i['id'] for i in retry['items']} == {i['id'] for i in result['items']}
    assert len(client.get('/api/items').json()) == 78


def test_preserves_existing_and_scope(client):
    cid, other = course(client),course(client,'02517')
    existing = client.post('/api/items',json={'title':'  LECTURE   Slides  ','kind':'lecture','course_id':cid,'week_number':1,'done':True,'notes':'keep','planned_date':'2026-11-20','due_date':'2026-11-25'}).json()
    exam = client.post('/api/items',json={'title':'Past year questions','kind':'revision','course_id':cid}).json()
    other_item = client.post('/api/items',json={'title':'Lecture slides','kind':'lecture','course_id':other,'week_number':1}).json()
    result = generate(client,cid,[DEFAULTS[0],DEFAULTS[3],{'title':'Lab work','kind':'exercise'}],[1,3]).json()
    assert (result['created'],result['skipped']) == (5,1)
    items = {i['id']:i for i in client.get('/api/items').json()}
    assert items[existing['id']] == existing and items[exam['id']] == exam and items[other_item['id']] == other_item
    assert all(i['week_number'] in [1,3] for i in result['items'])
    assert len(items)==8


@pytest.mark.parametrize('activities,weeks', [([], [1]),(DEFAULTS,[]),(DEFAULTS,[0]),(DEFAULTS,[14]),(DEFAULTS,[1,1]),([{'title':' ','kind':'lecture'}],[1]),([DEFAULTS[0],{'title':'lecture  SLIDES','kind':'notes'}],[1]),([{'title':'Personal','kind':'personal'}],[1])])
def test_invalid_inputs_are_atomic(client,activities,weeks):
    cid=course(client)
    assert generate(client,cid,activities,weeks).status_code==422
    assert client.get('/api/items').json()==[]


def test_archived_and_missing_course(client):
    cid=course(client)
    assert client.post(f'/api/courses/{cid}/archive').status_code==200
    assert generate(client,cid).status_code==409
    assert generate(client,'not-found').status_code==404
    assert client.get('/api/items').json()==[]


def test_concurrent_generation(client):
    cid=course(client)
    barrier=Barrier(4)
    def invoke(_):
        barrier.wait()
        response=generate(client,cid)
        assert response.status_code==200
        return response.json()['created']
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert sorted(executor.map(invoke,range(4)))==[0,0,0,78]


def test_manual_creation_and_rename_share_duplicate_guard(client):
    cid=course(client)
    original=client.post('/api/items',json={'title':'Other','kind':'exercise','course_id':cid,'week_number':1}).json()
    gate=Barrier(2)
    def gen():
        gate.wait();return generate(client,cid,[DEFAULTS[0]],[1])
    def rename():
        gate.wait();return client.patch('/api/items/'+original['id'],json={'title':'Lecture slides'})
    with ThreadPoolExecutor(max_workers=2) as pool:
        a,b=pool.submit(gen),pool.submit(rename)
        assert a.result().status_code==200
        assert b.result().status_code in (200,409)
    assert client.post('/api/items',json={'title':'lecture SLIDES','kind':'lecture','course_id':cid,'week_number':1}).status_code==409
    assert len([i for i in client.get('/api/items').json() if i['title']=='Lecture slides'])==1


def test_manual_creation_race(client):
    cid=course(client)
    gate=Barrier(2)
    def gen():
        gate.wait();return generate(client,cid,[DEFAULTS[0]],[1])
    def manual():
        gate.wait();return client.post('/api/items',json={'title':'Lecture slides','kind':'lecture','course_id':cid,'week_number':1})
    with ThreadPoolExecutor(max_workers=2) as pool:
        a,b=pool.submit(gen),pool.submit(manual)
        assert a.result().status_code==200
        assert b.result().status_code in (201,409)
    assert len(client.get('/api/items').json())==1


def test_maximum_batch_and_rollback(client,monkeypatch):
    cid=course(client,weeks=30)
    original=WorkspaceView.create_generated
    def fail(self,kind,doc):
        if kind=='items' and doc['week_number']==2: raise RuntimeError('injected failure')
        return original(self,kind,doc)
    with monkeypatch.context() as patch:
        patch.setattr(WorkspaceView,'create_generated',fail)
        with pytest.raises(RuntimeError): generate(client,cid,DEFAULTS,[1,2])
    assert client.get('/api/items').json()==[]
    choices=DEFAULTS+[{'title':f'Custom {i}','kind':'exercise'} for i in range(4)]
    assert generate(client,cid,choices,list(range(1,31))).json()['created']==300


def test_collection_scan_reused_for_creates():
    def unexpected(*args): raise AssertionError('unnecessary point read')
    tx=WorkspaceView(unexpected,lambda kind:[{'id':'old'}])
    tx.list('items')
    tx.create('items',{'id':'new'})
    assert tx.get('items','new')=={'id':'new'}
