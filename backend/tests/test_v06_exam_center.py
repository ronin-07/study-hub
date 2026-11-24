from concurrent.futures import ThreadPoolExecutor
from tests.test_phase_b2_workspace import client
from tests.helpers import create_course


def setup(client, kind='exam_paper', week=None):
    course = create_course(client, {'code':'02516','title':'Vision'}).json()
    paper = client.post('/api/resources',json={'title':'Winter 2025','course_id':course['id'],'kind':kind,'source':'drive','drive_file_id':'paper123','week_number':week}).json()
    return course,paper


def attempt(id='first', **kwargs):
    return {'id':id,'date':'2026-11-24','minutes':90,'notes':'Review CNNs','score':None,**kwargs}


def test_exam_details_optional_and_clearable(client):
    course,_=setup(client)
    assert course['exam_date'] is None
    url=f"/api/courses/{course['id']}"
    r=client.patch(url,json={'exam_date':'2026-12-08','exam_time':'09:00','exam_duration_minutes':240,'exam_format':'Written','exam_location':'Building 101'})
    assert r.status_code==200,r.text
    assert r.json()['exam_time']=='09:00:00'
    assert r.json()['exam_location']=='Building 101'
    assert client.patch(url,json={'exam_duration_minutes':0}).status_code==422
    assert client.patch(url,json={'exam_date':None,'exam_time':None}).json()['exam_date'] is None


def test_attempts_and_bookmarks_preserve_each_other(client):
    _,paper=setup(client)
    url=f"/api/resources/{paper['id']}"
    assert client.patch(url+'/reading-position',json={'page':12}).status_code==200
    r=client.post(url+'/exam-attempts',json=attempt())
    assert r.status_code==200,r.text
    assert r.json()['last_page']==12
    assert len(client.post(url+'/exam-attempts',json=attempt()).json()['exam_attempts'])==1
    assert client.post(url+'/exam-attempts',json=attempt(score=100)).status_code==409
    assert client.post(url+'/exam-attempts',json=attempt('second',score=0)).status_code==200
    assert client.post(url+'/exam-attempts',json=attempt('invalid',score=101)).status_code==422
    r=client.patch(url,json={'title':'Updated paper'})
    assert len(r.json()['exam_attempts'])==2
    assert len(client.patch(url+'/reading-position',json={'page':20}).json()['exam_attempts'])==2
    assert client.delete(url).status_code==409
    assert client.patch(url,json={'kind':'other'}).status_code==409
    assert client.delete(url+'/exam-attempts/first').json()['exam_attempts'][0]['score']==0


def test_concurrent_attempts_and_practice_task(client):
    course,paper=setup(client)
    url=f"/api/resources/{paper['id']}"
    with ThreadPoolExecutor(max_workers=4) as pool:
        results=list(pool.map(lambda i:client.post(url+'/exam-attempts',json=attempt(str(i))),range(4)))
    assert all(r.status_code==200 for r in results)
    assert len(client.get('/api/snapshot').json()['resources'][0]['exam_attempts'])==4
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks=list(pool.map(lambda i:client.post(url+'/practice-task'),range(4)))
    assert all(r.status_code==200 for r in tasks)
    assert len({r.json()['id'] for r in tasks})==1
    item=tasks[0].json()
    assert item['week_number'] is None and item['kind']=='revision' and item['resource_id']==paper['id']
    assert client.post('/api/courses/'+course['id']+'/archive').status_code==200
    assert client.post(url+'/exam-attempts',json=attempt('later')).status_code==409
    assert client.post(url+'/practice-task').status_code==409
    assert client.delete(url+'/exam-attempts/0').status_code==409


def test_wrong_resource_and_weekly_paper(client):
    course,paper=setup(client,'textbook')
    url=f"/api/resources/{paper['id']}"
    assert client.post(url+'/exam-attempts',json=attempt()).status_code==404
    assert client.post(url+'/practice-task').status_code==404
    assert client.post('/api/resources',json={'title':'Weekly paper','course_id':course['id'],'kind':'exam_paper','source':'drive','drive_file_id':'paper456','week_number':2}).status_code==201
