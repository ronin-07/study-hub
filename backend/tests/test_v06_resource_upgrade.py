"""The same records are reused for bulk linking, unlinking and exam pairing."""
from tests.test_v06_resource_removal import setup, item, preview, remove, client, race, firestore_store
from tests.helpers import create_course


def doc(course, file_id, **fields):
    return {'course_id':course['id'],'title':file_id,'source':'drive','drive_file_id':file_id,**fields}


def add(client, course, file_id, **fields):
    r=client.post('/api/resources',json=doc(course,file_id,**fields)); assert r.status_code==201,r.text
    return r.json()


def test_multiple_weekly_attachments_and_dual_reference_detach(client):
    c=create_course(client,{'code':'TEST','title':'Course'}).json()
    i=item(client,c)
    a=add(client,c,'slides-file',week_number=1,item_id=i['id']);b=add(client,c,'notes-file',week_number=1,item_id=i['id'])
    i=client.patch('/api/items/'+i['id'],json={'resource_id':a['id']}).json()
    url='/api/resources/'+a['id'];old=preview(client,url)
    response=client.post(url+'/detach',json={'item_id':i['id']});assert response.status_code==200,response.text
    assert response.json()['resource']['item_id'] is None
    assert response.json()['items']==[{**i,'resource_id':None}]
    assert remove(client,url,old).status_code==409
    snap=client.get('/api/snapshot').json();assert len(snap['resources'])==2
    assert next(r for r in snap['resources'] if r['id']==b['id'])['item_id']==i['id']
    assert remove(client,url,preview(client,url)).status_code==200
    assert client.get('/api/snapshot').json()['items']==[{**i,'resource_id':None}]


def test_removing_one_of_multiple_links_keeps_others_and_activity(client):
    c=create_course(client,{'code':'TEST','title':'Course'}).json();i=item(client,c)
    a=add(client,c,'slides-file',week_number=1,item_id=i['id']);b=add(client,c,'notes-file',week_number=1,item_id=i['id'])
    i=client.patch('/api/items/'+i['id'],json={'resource_id':b['id']}).json()
    url='/api/resources/'+a['id'];p=preview(client,url);assert p['affected_count']==1
    assert client.delete(url).status_code==409
    assert remove(client,url,p).json()['items']==[]
    snap=client.get('/api/snapshot').json();assert snap['resources']==[b];assert snap['items']==[i]


def test_pair_and_remove_solution_preserves_attempts_and_other_solution(client):
    c=create_course(client,{'code':'TEST','title':'Course'}).json();paper=add(client,c,'paper-file',kind='exam_paper')
    sol=add(client,c,'solution-file',kind='exam_solution',exam_paper_id=paper['id']);other=add(client,c,'other-solution',kind='exam_solution',exam_paper_id=paper['id'])
    purl='/api/resources/'+paper['id'];surl='/api/resources/'+sol['id']
    saved=client.post(purl+'/exam-attempts',json={'date':'2026-11-24','minutes':30,'score':80}).json()
    assert preview(client,purl)['blockers']
    assert client.patch(purl,json={'kind':'slides'}).status_code==409
    assert client.delete(surl).status_code==409
    p=preview(client,surl);assert p['paired_paper_title']==paper['title'] and not p['blockers']
    assert remove(client,surl,p).status_code==200
    snap=client.get('/api/snapshot').json();assert {r['id']:r for r in snap['resources']}=={paper['id']:saved,other['id']:other}


def test_pair_guard_and_stale_preview(client):
    c=create_course(client,{'code':'TEST','title':'Course'}).json();other=create_course(client,{'code':'ELSE','title':'Other'}).json()
    paper=add(client,c,'paper-file',kind='exam_paper');sol=add(client,c,'solution-file',kind='exam_solution')
    wrong=add(client,other,'other-paper',kind='exam_paper');url='/api/resources/'+paper['id'];p=preview(client,url)
    assert client.patch('/api/resources/'+sol['id'],json={'exam_paper_id':wrong['id']}).status_code==422
    assert client.patch('/api/resources/'+sol['id'],json={'exam_paper_id':paper['id']}).status_code==200
    assert remove(client,url,p).status_code==409
    assert client.patch(url,json={'kind':'slides'}).status_code==409
    assert client.patch('/api/resources/'+sol['id'],json={'exam_paper_id':None}).status_code==200
    assert remove(client,url,preview(client,url)).status_code==200
    assert client.get('/api/snapshot').json()['resources'][-1]['id'] in {wrong['id'],sol['id']}


def test_bulk_reuse_pair_and_rollback_on_bad_destination(client):
    c=create_course(client,{'code':'TEST','title':'Course'}).json();i=item(client,c)
    url='/api/resources/bulk'
    rows=[doc(c,'exam-file',id='new-paper',kind='exam_paper'),doc(c,'sol-file',id='new-sol',kind='exam_solution',exam_paper_id='new-paper'),doc(c,'lecture-file',id='new-slides',week_number=1,item_id=i['id'])]
    # Deliberately put solution before paper, to exercise dependency ordering.
    result=client.post(url,json={'resources':[rows[1],rows[0],rows[2]]});assert result.status_code==200,result.text
    assert result.json()['created']==3
    again=client.post(url,json={'resources':rows});assert again.status_code==200,again.text;assert again.json()['skipped']==3
    retry=[{**rows[0],'id':'retry-paper'},{**rows[1],'id':'retry-sol','exam_paper_id':'retry-paper'}]
    assert client.post(url,json={'resources':retry}).json()['skipped']==2
    bad=[doc(c,'new-valid',id='valid-one'),doc(c,'bad-week',id='bad-one',week_number=2,item_id=i['id'])]
    assert client.post(url,json={'resources':bad}).status_code==422
    assert len(client.get('/api/snapshot').json()['resources'])==3
    assert client.post(url,json={'resources':[doc(c,'exam-file',id='new-other',kind='slides')]}).status_code==409


def test_concurrent_pair_vs_removal_cannot_leave_dangling_link(client):
    c=create_course(client,{'code':'TEST','title':'Course'}).json();paper=add(client,c,'paper-file',kind='exam_paper');sol=add(client,c,'sol-file',kind='exam_solution')
    url='/api/resources/'+paper['id'];p=preview(client,url)
    def operation(n):return (remove(client,url,p) if n==0 else client.patch('/api/resources/'+sol['id'],json={'exam_paper_id':paper['id']})).status_code
    assert race(2,operation) in ([200,422],[409,200])
    resources=client.get('/api/snapshot').json()['resources'];ids={r['id'] for r in resources}
    assert all(not r.get('exam_paper_id') or r['exam_paper_id'] in ids for r in resources)


def test_firestore_bulk_and_removal_operations(firestore_store,monkeypatch):
    from app import main
    from app.models import Resource
    from app.security import User
    from fastapi import HTTPException
    import pytest
    store=firestore_store;uid='alice';user=User(uid);monkeypatch.setattr(main,'app_store',store)
    store.db.docs[store.col(uid,'courses').document('target').path]={'id':'target','code':'TEST','week_count':13}
    paper=Resource(id='paper',course_id='target',title='Paper',source='drive',drive_file_id='paper-file',kind='exam_paper')
    sol=Resource(id='solution',course_id='target',title='Solution',source='drive',drive_file_id='solution-file',kind='exam_solution',exam_paper_id='paper')
    bulk=main.BulkResources(resources=[sol,paper]);assert main.bulk_resources(bulk,user)['created']==2
    before=dict(store.db.docs);assert main.bulk_resources(bulk,user)['skipped']==2;assert store.db.docs==before
    p=main.preview_resource_removal('paper',user);assert p['blockers'];assert store.db.docs==before
    with pytest.raises(HTTPException):main.remove_resource_with_links('paper',main.ResourceRemovalConfirmation(preview_token=p['preview_token']),user)
    assert store.db.docs==before
    p=main.preview_resource_removal('solution',user);assert p['paired_paper_title']=='Paper'
    main.remove_resource_with_links('solution',main.ResourceRemovalConfirmation(preview_token=p['preview_token']),user)
    assert store.get(uid,'resources','paper')==paper.model_dump(mode='json') and store.get(uid,'resources','solution') is None


def test_bulk_13_week_files_with_existing_activity_and_size_limit(client):
    c=create_course(client,{'code':'TEST','title':'Course'}).json();rows=[]
    for n in range(1,14):
        i=client.post('/api/items',json={'course_id':c['id'],'title':'Lecture slides','kind':'lecture','week_number':n}).json()
        rows.append(doc(c,'week-file-'+str(n),week_number=n,item_id=i['id']))
    response=client.post('/api/resources/bulk',json={'resources':rows});assert response.status_code==200,response.text
    assert response.json()['created']==13
    resources=client.get('/api/snapshot').json()['resources'];assert len(resources)==13
    assert {r['week_number'] for r in resources}==set(range(1,14)) and all(r['item_id'] for r in resources)
    too_many=[doc(c,'extra-file-'+str(n)) for n in range(31)]
    assert client.post('/api/resources/bulk',json={'resources':too_many}).status_code==422
    assert len(client.get('/api/snapshot').json()['resources'])==13


def test_removal_rejects_changed_bookmark_and_preserves_other_bookmark(client):
    c=create_course(client,{'code':'TEST','title':'Course'}).json();i=item(client,c)
    a=add(client,c,'slides-file',week_number=1,item_id=i['id']);b=add(client,c,'notes-file',week_number=1,item_id=i['id'])
    url='/api/resources/'+a['id'];old=preview(client,url)
    assert client.patch(url+'/reading-position',json={'page':12}).status_code==200
    assert client.patch('/api/resources/'+b['id']+'/reading-position',json={'page':21}).status_code==200
    assert remove(client,url,old).status_code==409
    assert remove(client,url,preview(client,url)).status_code==200
    snap=client.get('/api/snapshot').json();assert snap['resources']==[{**b,'last_page':21}]
    assert snap['items']==[i]


def test_cross_course_legacy_exam_reference_blocks_course_deletion(client):
    from app import main
    c=create_course(client,{'code':'TEST','title':'Course'}).json();other=create_course(client,{'code':'ELSE','title':'Other'}).json()
    paper=add(client,c,'paper-file',kind='exam_paper');solution=add(client,other,'other-solution',kind='exam_solution')
    assert client.patch('/api/resources/'+solution['id'],json={'exam_paper_id':paper['id']}).status_code==422
    main.app_store.put('local-owner','resources',{**solution,'exam_paper_id':paper['id']})
    assert client.post('/api/courses/'+c['id']+'/archive').status_code==200
    p=client.get('/api/courses/'+c['id']+'/deletion-preview').json();assert p['blockers']


def test_firestore_removal_failure_rolls_back_all_links_and_keeps_focus(firestore_store,monkeypatch):
    from app import main
    from app.models import Item, Resource, FocusSession
    from app.security import User
    from app.storage import WorkspaceView
    import copy
    import pytest
    store=firestore_store;uid='alice';user=User(uid);monkeypatch.setattr(main,'app_store',store)
    resource=Resource(id='pdf',course_id='target',title='PDF',source='drive',drive_file_id='pdf-file',week_number=1,last_page=17)
    activity=Item(id='item',title='Study',course_id='target',week_number=1,kind='lecture',resource_id='pdf',done=True,completed_at=100)
    focus=FocusSession(id='focus',course_id='target',item_id='item',week_number=1,started_at=1,ended_at=100,status='finished',focus_seconds=99)
    for kind,entry in [('courses',{'id':'target','code':'TEST','week_count':13}),('resources',resource.model_dump(mode='json')),('items',activity.model_dump(mode='json')),('sessions',focus.model_dump(mode='json')),('focus_stats',{'id':'state','total_seconds':99,'completed_sessions':1})]:
        store.db.docs[store.col(uid,kind).document(entry['id']).path]=entry
    original=copy.deepcopy(store.db.docs)
    p=main.preview_resource_removal('pdf',user)
    actual_delete=WorkspaceView.delete
    def fail(self,kind,identifier):
        if kind=='resources':raise RuntimeError('injected failure after staging item unlink')
        return actual_delete(self,kind,identifier)
    monkeypatch.setattr(WorkspaceView,'delete',fail)
    with pytest.raises(RuntimeError):main.remove_resource_with_links('pdf',main.ResourceRemovalConfirmation(preview_token=p['preview_token']),user)
    assert store.db.docs==original
    monkeypatch.setattr(WorkspaceView,'delete',actual_delete)
    result=main.remove_resource_with_links('pdf',main.ResourceRemovalConfirmation(preview_token=p['preview_token']),user)
    assert result.items[0].resource_id is None
    assert store.get(uid,'sessions','focus')==focus.model_dump(mode='json')
    assert store.get(uid,'focus_stats','state')=={'id':'state','total_seconds':99,'completed_sessions':1}
