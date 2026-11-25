"""Safe resource removal uses the existing workspace transaction and private user scope."""
from tests.test_phase_b2_workspace import client, race
from tests.helpers import create_course


def setup(client, kind='slides'):
    course = create_course(client, {'code':'TEST','title':'Test course'}).json()
    resource = client.post('/api/resources',json={'course_id':course['id'],'title':'PDF','source':'drive','drive_file_id':'shared-file','kind':kind}).json()
    return course,resource,'/api/resources/'+resource['id']


def item(client,course,resource=None,title='Study'):
    r=client.post('/api/items',json={'course_id':course['id'],'title':title,'kind':'lecture','week_number':1,'done':True,'notes':'Keep notes','planned_date':'2026-11-24','resource_id':resource['id'] if resource else None})
    assert r.status_code==201,r.text
    return r.json()


def preview(client,url):
    r=client.get(url+'/removal-preview');assert r.status_code==200,r.text
    return r.json()


def remove(client,url,p):
    return client.post(url+'/remove',json={'preview_token':p['preview_token']})


def test_unlink_multiple_items_preserves_progress_and_original_file(client):
    from app import main
    c,r,url=setup(client)
    items=[item(client,c,r,title) for title in ['Read','Review']]
    other=create_course(client,{'code':'KEEP','title':'Other'}).json()
    keep=client.post('/api/resources',json={'course_id':other['id'],'title':'Other link','source':'drive','drive_file_id':'shared-file'}).json()
    main.app_store.put('local-owner','drive-index',{'id':'shared-file','name':'PDF'})
    assert client.delete(url).status_code==409
    p=preview(client,url);assert p['affected_count']==2 and not p['blockers']
    assert client.get('/api/snapshot').json()['resources'] # preview is read-only
    result=remove(client,url,p);assert result.status_code==200,result.text
    assert result.json()['resource_id']==r['id']
    expected={i['id']:{**i,'resource_id':None} for i in items}
    assert {i['id']:i for i in result.json()['items']}==expected
    snap=client.get('/api/snapshot').json()
    assert {i['id']:i for i in snap['items']}==expected
    assert [x['id'] for x in snap['resources']]==[keep['id']]
    assert main.app_store.get('local-owner','drive-index','shared-file')
    assert remove(client,url,p).status_code==404


def test_unlinked_and_reverse_attachment(client):
    c,r,url=setup(client)
    p=preview(client,url);assert p['affected_count']==0
    assert remove(client,url,p).json()['items']==[]
    i=item(client,c)
    r=client.post('/api/resources',json={'course_id':c['id'],'week_number':1,'item_id':i['id'],'title':'Weekly PDF','source':'drive','drive_file_id':'weekly-file'}).json()
    url='/api/resources/'+r['id'];p=preview(client,url)
    assert p['affected_count']==1
    assert remove(client,url,p).json()['items']==[]
    assert client.get('/api/snapshot').json()['items']==[i]


def test_stale_preview_and_attempt_protection(client):
    c,r,url=setup(client,'exam_paper')
    i=item(client,c,r);p=preview(client,url)
    assert client.patch('/api/items/'+i['id'],json={'notes':'New notes'}).status_code==200
    assert remove(client,url,p).status_code==409
    p=preview(client,url)
    assert client.post(url+'/exam-attempts',json={'date':'2026-11-24','minutes':30}).status_code==200
    assert remove(client,url,p).status_code==409
    assert preview(client,url)['blockers']
    assert client.post('/api/courses/'+c['id']+'/archive').status_code==200
    assert client.get(url+'/removal-preview').status_code==409


def test_concurrent_link_and_removal_cannot_leave_dangling_reference(client):
    c,r,url=setup(client);i=item(client,c);p=preview(client,url)
    def operation(n):
        return (remove(client,url,p) if n==0 else client.patch('/api/items/'+i['id'],json={'resource_id':r['id']})).status_code
    codes=race(2,operation)
    assert codes in ([200,404],[409,200]),codes
    snap=client.get('/api/snapshot').json()
    assert all(not i.get('resource_id') or any(r['id']==i['resource_id'] for r in snap['resources']) for i in snap['items'])


def test_legacy_cross_course_and_oversized_removal_blocked(client):
    from app import main
    c,r,url=setup(client);store=main.app_store
    other=create_course(client,{'code':'KEEP','title':'Other'}).json()
    store.put('local-owner','items',{'id':'legacy','course_id':other['id'],'title':'Legacy','resource_id':r['id']})
    p=preview(client,url);assert p['blockers'] and remove(client,url,p).status_code==409
    store.delete('local-owner','items','legacy')
    for n in range(450):store.put('local-owner','items',{'id':f'item-{n}','course_id':c['id'],'title':'Large','resource_id':r['id']})
    p=preview(client,url);assert p['blockers'] and remove(client,url,p).status_code==409


from tests.test_phase_b_firestore_contract import firestore_store


def test_simulated_firestore_preview_and_atomic_unlink(firestore_store,monkeypatch):
    from app import main
    from app.security import User
    from app.models import Item
    from fastapi import HTTPException
    import pytest
    store=firestore_store;uid='alice'
    monkeypatch.setattr(main,'app_store',store)
    item=Item(id='one',title='Study',course_id='target',kind='lecture',resource_id='pdf',done=True,completed_at=100).model_dump(mode='json')
    for kind,doc in [('courses',{'id':'target','code':'TEST'}),('resources',{'id':'pdf','course_id':'target','title':'PDF','source':'drive'}),('items',item)]:
        store.db.docs[store.col(uid,kind).document(doc['id']).path]=doc
    before=dict(store.db.docs)
    p=main.preview_resource_removal('pdf',User(uid));assert store.db.docs==before
    with pytest.raises(HTTPException) as exc:main.preview_resource_removal('pdf',User('bob'))
    assert exc.value.status_code==404
    result=main.remove_resource_with_links('pdf',main.ResourceRemovalConfirmation(preview_token=p['preview_token']),User(uid))
    assert result.items[0].resource_id is None
    assert store.get(uid,'items','one')=={**item,'resource_id':None}
    assert store.get(uid,'resources','pdf') is None
