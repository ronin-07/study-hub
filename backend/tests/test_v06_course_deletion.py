"""Safe permanent deletion: local API and simulated Firestore, no live data."""
from tests.test_phase_b2_workspace import client, race
from tests.test_phase_b_firestore_contract import firestore_store
from tests.helpers import create_course
from app.security import User, current_user
from app.workspace import course_deletion_plan


def course(client, code='TEST'):
    r = create_course(client, {'code':code,'title':'Temporary course'})
    assert r.status_code == 201, r.text
    return r.json()['id']


def route(cid):
    return '/api/courses/'+cid


def archive(client,cid):
    assert client.post(route(cid)+'/archive').status_code == 200
    r = client.get(route(cid)+'/deletion-preview')
    assert r.status_code == 200, r.text
    return r.json()


def delete(client,cid,preview,confirmation='DELETE'):
    return client.post(route(cid)+'/permanent-delete',json={'confirmation':confirmation,'preview_token':preview['preview_token']})


def test_delete_91_activities_and_linked_records_only(client):
    from app import main
    cid = course(client)
    other = course(client,'KEEP')
    assert client.get(route(cid)+'/deletion-preview').status_code == 409
    assert client.post(route(cid)+'/permanent-delete',json={'confirmation':'DELETE','preview_token':'0'*64}).status_code == 409
    activities = [{'title':f'Activity {n}','kind':'lecture'} for n in range(7)]
    r=client.post(route(cid)+'/generate-activities',json={'weeks':list(range(1,14)),'activities':activities})
    assert r.status_code==200,r.text
    assert r.json()['created']==91
    item=r.json()['items'][0]
    assert client.post('/api/weeks',json={'course_id':cid,'number':1,'title':'Test'}).status_code==201
    resource=client.post('/api/resources',json={'course_id':cid,'week_number':1,'title':'PDF','kind':'slides','source':'drive','drive_file_id':'shared-file','item_id':item['id']}).json()
    paper=client.post('/api/resources',json={'course_id':cid,'title':'Paper','kind':'exam_paper','source':'drive','drive_file_id':'paper-file'}).json()
    assert client.post('/api/resources/'+paper['id']+'/exam-attempts',json={'date':'2026-11-24','minutes':30}).status_code==200
    keep=client.post('/api/resources',json={'course_id':other,'title':'Shared PDF','kind':'slides','source':'drive','drive_file_id':'shared-file'}).json()
    main.app_store.put('local-owner','drive-index',{'id':'shared-file','name':'PDF'})
    preview=archive(client,cid)
    assert (preview['items'],preview['weeks'],preview['resources'],preview['exam_attempts'],preview['focus_sessions'],preview['total_documents'])==(91,1,2,1,0,95)
    assert preview['blockers']==[]
    assert delete(client,cid,preview,'delete').status_code==422
    assert client.delete(route(cid)).status_code==405
    assert delete(client,cid,preview).status_code==204
    snap=client.get('/api/snapshot').json()
    assert [c['id'] for c in snap['courses']]==[other]
    assert not snap['items'] and not snap['weeks']
    assert [r['id'] for r in snap['resources']]==[keep['id']]
    assert main.app_store.get('local-owner','drive-index','shared-file')
    assert snap['semesters']
    assert delete(client,cid,preview).status_code==404


def test_stale_preview_and_restored_course_are_rejected(client):
    cid=course(client)
    res=client.post('/api/resources',json={'course_id':cid,'title':'PDF','kind':'slides','source':'drive','drive_file_id':'test-file'}).json()
    preview=archive(client,cid)
    assert client.patch('/api/resources/'+res['id']+'/reading-position',json={'page':3}).status_code==200
    assert delete(client,cid,preview).status_code==409
    latest=client.get(route(cid)+'/deletion-preview').json()
    assert latest['preview_token']!=preview['preview_token']
    assert client.post(route(cid)+'/restore').status_code==200
    assert delete(client,cid,latest).status_code==409
    assert client.get('/api/snapshot').json()['resources'][0]['last_page']==3


def test_focus_history_is_blocked_and_totals_preserved(client,monkeypatch):
    from app import main
    clock=[1000];monkeypatch.setattr(main,'now_s',lambda:clock[0])
    cid=course(client)
    session=client.post('/api/sessions/start',json={'course_id':cid}).json()
    clock[0]+=60
    assert client.post('/api/sessions/'+session['id']+'/finish',json={}).status_code==200
    preview=archive(client,cid)
    assert preview['focus_sessions']==1 and preview['blockers']
    before=client.get('/api/snapshot').json()
    assert delete(client,cid,preview).status_code==409
    assert client.get('/api/snapshot').json()==before


def test_cross_course_legacy_link_and_large_course_are_blocked(client):
    from app import main
    cid=course(client)
    other=course(client,'KEEP')
    store=main.app_store; uid='local-owner'
    r=client.post('/api/resources',json={'course_id':cid,'title':'PDF','source':'link','url':'https://example.org/p.pdf'}).json()
    store.put(uid,'items',{'id':'legacy','course_id':other,'resource_id':r['id']})
    preview=archive(client,cid)
    assert any('Other coursework' in s for s in preview['blockers'])
    assert delete(client,cid,preview).status_code==409
    store.delete(uid,'items','legacy')
    for i in range(450):store.put(uid,'items',{'id':f'item-{i}','course_id':cid})
    preview=client.get(route(cid)+'/deletion-preview').json()
    assert preview['total_documents']==452 and preview['blockers']
    assert delete(client,cid,preview).status_code==409
    assert len(store.list(uid,'items'))==450


def test_user_scope_and_concurrent_restore(client):
    cid=course(client)
    preview=archive(client,cid)
    client.app.dependency_overrides[current_user]=lambda:User('different-user')
    try:
        assert client.get(route(cid)+'/deletion-preview').status_code==404
        assert delete(client,cid,preview).status_code==404
    finally:client.app.dependency_overrides.pop(current_user)
    results=race(2,lambda i:(delete(client,cid,preview) if i==0 else client.post(route(cid)+'/restore')).status_code)
    assert results in ([204,404],[409,200]),results


def test_simulated_firestore_atomic_delete_and_no_preview_writes(firestore_store):
    from app.workspace import permanently_delete_course, preview_course_deletion, CourseDeletionConfirmation
    from unittest.mock import patch
    from fastapi import HTTPException
    store=firestore_store; uid='alice'
    for kind,doc in [('courses',{'id':'target','code':'TEST','title':'Test','archived':True}),('items',{'id':'one','course_id':'target'}),('weeks',{'id':'w','course_id':'target'}),('resources',{'id':'r','course_id':'target'}),('items',{'id':'keep','course_id':'other'})]:
        store.db.docs[store.col(uid,kind).document(doc['id']).path]=doc
    before=dict(store.db.docs)
    with patch('app.workspace.store',return_value=store):
        preview=preview_course_deletion('target',User(uid))
        assert store.db.docs==before
        permanently_delete_course('target',CourseDeletionConfirmation(confirmation='DELETE',preview_token=preview['preview_token']),User(uid))
    assert store.get(uid,'courses','target') is None
    assert store.get(uid,'items','one') is None
    assert store.get(uid,'weeks','w') is None
    assert store.get(uid,'resources','r') is None
    assert store.get(uid,'items','keep')
