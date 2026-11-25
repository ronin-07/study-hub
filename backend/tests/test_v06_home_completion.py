"""Persist completion time on existing item writes, without a history collection."""
import time
from tests.test_phase_b2_workspace import client


def test_completion_timestamp_persists_and_is_idempotent(client):
    item = client.post('/api/items', json={'title':'Catch up','planned_date':'2026-11-20'}).json()
    assert item['completed_at'] is None
    url = '/api/items/' + item['id']
    before = int(time.time())
    saved = client.patch(url+'/with-successor', json={'done':True}).json()['item']
    assert before <= saved['completed_at'] <= int(time.time())
    assert client.patch(url, json={'done':True}).json()['completed_at'] == saved['completed_at']
    assert client.patch(url, json={'notes':'Updated'}).json()['completed_at'] == saved['completed_at']
    assert client.get('/api/snapshot').json()['items'][0]['completed_at'] == saved['completed_at']
    assert client.patch(url, json={'done':False}).json()['completed_at'] is None
    assert client.patch(url, json={'done':True}).json()['completed_at'] >= saved['completed_at']


def test_recurring_successor_does_not_inherit_completion_timestamp(client):
    item = client.post('/api/items',json={'title':'Repeat','planned_date':'2026-11-20','repeat':'weekly'}).json()
    saved = client.patch('/api/items/'+item['id']+'/with-successor',json={'done':True}).json()
    assert saved['item']['completed_at'] is not None
    assert saved['successor']['done'] is False
    assert saved['successor']['completed_at'] is None


def test_legacy_completed_item_does_not_get_invented_date(client):
    import app.main as main
    from app.models import Item
    row = Item(title='Already done', done=True, planned_date='2026-11-20').model_dump(mode='json')
    row.pop('completed_at')
    main.app_store.put('local-owner','items',row)
    url='/api/items/'+row['id']
    assert client.patch(url,json={'notes':'Old notes'}).json()['completed_at'] is None
    assert client.patch(url,json={'done':True}).json()['completed_at'] is None
    assert client.patch(url,json={'done':False}).json()['completed_at'] is None
    assert client.patch(url,json={'done':True}).json()['completed_at'] is not None
