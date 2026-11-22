"""No cloud SDK is required to validate Firestore Drive batch size and no-op behavior."""
from copy import deepcopy
from app.storage import FirestoreStore


class Batch:
    def __init__(self, db):
        self.db, self.ops = db, []
    def set(self, ref, doc):
        self.ops.append(('set',ref,deepcopy(doc)))
    def delete(self, ref):
        self.ops.append(('delete',ref,None))
    def commit(self):
        assert 0 < len(self.ops) <= 400
        self.db.commits.append(len(self.ops))
        for op, ref, doc in self.ops:
            if op=='delete': self.db.docs.pop(ref,None)
            else: self.db.docs[ref]=doc


class FakeCollection:
    def __init__(self, db, uid, kind):
        self.db, self.uid, self.kind = db, uid, kind
    def document(self, identifier):
        return (self.uid,self.kind,identifier)


class FakeDB:
    def __init__(self):
        self.docs, self.commits = {}, []
    def batch(self): return Batch(self)


def test_firestore_drive_diff_batches_only_changed_records(monkeypatch):
    store = FirestoreStore.__new__(FirestoreStore)
    store.db = FakeDB()
    monkeypatch.setattr(store, 'col', lambda uid,kind:FakeCollection(store.db,uid,kind))
    monkeypatch.setattr(store, 'list', lambda uid,kind:[deepcopy(value) for (u,k,_),value in store.db.docs.items() if (u,k)==(uid,kind)])
    docs = {f'f{i}': {'id':f'f{i}','name':f'{i}.pdf'} for i in range(500)}
    assert store.sync_index('owner',docs)['added'] == 500
    assert store.db.commits == [400,100]
    store.db.commits.clear()
    assert store.sync_index('owner',docs)=={'added':0,'updated':0,'removed':0}
    assert store.db.commits == []
    changed = dict(docs)
    changed['f0']={'id':'f0','name':'Updated.pdf'}
    assert store.sync_index('owner',changed)=={'added':0,'updated':1,'removed':0}
    assert store.db.commits == [1]
    store.db.commits.clear()
    assert store.sync_index('owner',{})['removed']==500
    assert store.db.commits == [400,100]
