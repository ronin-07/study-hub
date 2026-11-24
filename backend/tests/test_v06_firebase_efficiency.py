"""Operation budgets against the simulated adapter, not billed Firestore reads."""
from threading import Lock
from app.storage import DB_DIAGNOSTICS, check_document_size
from tests.test_phase_b_firestore_contract import firestore_store
from tests.test_phase_b2_workspace import client


def test_filtered_scan_and_duplicate_noop(firestore_store):
    store = firestore_store
    for i in range(234):
        doc = {'id': str(i), 'course_id': 'other'}
        store.db.docs[store.col('alice', 'items').document(doc['id']).path] = doc
    def generate(tx):
        existing = tx.list_equal('items', 'course_id', 'target')
        if not existing:
            for i in range(78):
                tx.create_generated('items', {'id': f'new-{i}', 'course_id': 'target'})
        return len(existing)
    counters = {'lock': Lock()}
    token = DB_DIAGNOSTICS.set(counters)
    try:
        assert store.workspace_atomic('alice', generate) == 0
        assert counters['point_reads'] == 1
        assert counters['query_documents'] == 0
        assert counters['staged_writes'] == 79
        before = dict(store.db.docs)
        assert store.workspace_atomic('alice', generate) == 78
        assert counters['query_documents'] == 78
        assert counters['staged_writes'] == 79
        assert store.db.docs == before
    finally:
        DB_DIAGNOSTICS.reset(token)


def test_focus_overview_only_queries_recent_when_needed(firestore_store):
    store = firestore_store
    store.db.docs[store.col('alice','focus_summary').document('state').path] = {'id':'state','total_seconds':1200,'completed_sessions':20}
    for i in range(20):
        doc = {'id':str(i),'status':'finished','ended_at':100+i,'focus_seconds':60}
        store.db.docs[store.col('alice','sessions').document(doc['id']).path] = doc
    for start, expected_queries, expected_docs, expected_sessions in [(100,1,20,20),(117,2,8,5)]:
        counts = {'lock':Lock()}
        token = DB_DIAGNOSTICS.set(counts)
        try:
            result = store.focus_overview('alice',start)
            assert len(result['sessions']) == expected_sessions
            assert counts['queries'] == expected_queries
            assert counts['query_documents'] == expected_docs
        finally:
            DB_DIAGNOSTICS.reset(token)


def test_recurrence_response_keeps_existing_successor(client):
    item = client.post('/api/items',json={'title':'Review','kind':'personal','repeat':'weekly','planned_date':'2026-11-23'}).json()
    url = '/api/items/'+item['id']+'/with-successor'
    r = client.patch(url,json={'done':True}); assert r.status_code == 200
    payload = r.json(); assert payload['item']['done']; successor = payload['successor']
    assert successor['planned_date']=='2026-11-30'
    assert client.patch('/api/items/'+successor['id'],json={'title':'Edited next task'}).status_code==200
    assert client.patch(url,json={'done':True}).json()['successor']['title']=='Edited next task'
    assert client.patch(url,json={'done':False}).json()['successor'] is None
    assert client.patch(url,json={'done':True}).json()['successor']['id']==successor['id']
    assert len(client.get('/api/items').json())==2


def test_size_warnings_do_not_log_payload(caplog):
    doc = {'id':'private-id','notes':'secret-value'+'😀'*140000}
    check_document_size('resources',doc)
    assert not caplog.records
    token = DB_DIAGNOSTICS.set({'lock':Lock()})
    try:
        check_document_size('resources',doc)
        assert 'level=high' in caplog.text
        assert 'secret-value' not in caplog.text and 'private-id' not in caplog.text
    finally:
        DB_DIAGNOSTICS.reset(token)
