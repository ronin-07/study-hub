from concurrent.futures import ThreadPoolExecutor
import time
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


def test_practice_task_uses_exam_display_name_and_keeps_its_existing_title(client):
    course, paper = setup(client)
    url = f"/api/resources/{paper['id']}"
    assert client.patch(url+'/exam-details', json={'display_name':'Final mock', 'year':None}).status_code == 200
    task = client.post(url+'/practice-task').json()
    assert task['title'] == 'Practise Final mock'
    assert client.patch(url+'/exam-details', json={'display_name':'New mock label', 'year':None}).status_code == 200
    assert client.post(url+'/practice-task').json() == task

    for index, (title, display_name) in enumerate([
        ('02450ex_Spring2017.pdf', 'Spring 2017'),
        ('02450_2017-Fall_corrected.PDF', 'Autumn 2017'),
        ('Undated mock.PDF', 'Undated mock'),
    ]):
        response = client.post('/api/resources', json={
            'title':title, 'course_id':course['id'], 'kind':'exam_paper',
            'source':'drive', 'drive_file_id':f'paper-{index}',
        })
        assert response.status_code == 201, response.text
        task_response = client.post(f"/api/resources/{response.json()['id']}/practice-task")
        assert task_response.status_code == 200, task_response.text
        assert task_response.json()['title'] == f'Practise {display_name}'


def test_custom_practice_countdown_and_stopwatch_keep_the_existing_focus_guard(client,monkeypatch):
    from app import main
    course,paper=setup(client)
    practice='/api/resources/'+paper['id']+'/practice-task'
    start='/api/sessions/start'
    monkeypatch.setattr(main,'now_s',lambda:1000)
    for invalid in ('0','721','17.5','001','unknown',25):
        assert client.post(start,json={'mode':invalid}).status_code==422
    stopwatch=client.post(start,json={'mode':'free'}).json()
    assert client.post(practice).status_code==409
    assert client.get('/api/snapshot').json()['items']==[]
    session='/api/sessions/'+stopwatch['id']
    assert client.post(session+'/pause').json()['status']=='paused'
    assert client.post(practice).status_code==409
    assert client.post(start,json={'mode':'137'}).status_code==409
    assert client.delete(session).status_code==204

    task=client.post(practice).json()
    assert client.post(practice).json()==task
    countdown=client.post(start,json={'mode':'137','item_id':task['id']})
    assert countdown.status_code==201,countdown.text
    running=countdown.json()
    assert (running['course_id'],running['item_id'],running['mode'])==(course['id'],task['id'],'137')
    assert client.get(f'/api/snapshot?compact=true&week_start={int(time.time())}').json()['sessions']==[running]

    monkeypatch.setattr(main,'now_s',lambda:1020)
    session='/api/sessions/'+running['id']
    assert client.post(session+'/pause').json()['mode']=='137'
    monkeypatch.setattr(main,'now_s',lambda:1030)
    assert client.post(session+'/resume').json()['mode']=='137'
    monkeypatch.setattr(main,'now_s',lambda:1050)
    finished=client.post(session+'/finish',json={}).json()
    assert finished['focus_seconds']==40
    assert finished['mode']=='137' and finished['status']=='finished'
    assert client.get('/api/snapshot').json()['resources'][0]['exam_attempts']==[]
    assert client.post(start,json={'mode':'720'}).status_code==201
