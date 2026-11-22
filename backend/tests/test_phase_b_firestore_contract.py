"""Firestore adapter contract tests without cloud credentials.

These simulate transaction read/write ordering and atomic commit; the real
Firestore Emulator integration remains a separate mandatory Preview release gate.
"""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.storage import (ActiveSessionExists, DocumentMissing, FirestoreStore,
                         SessionStateConflict)


class Snapshot:
    def __init__(self, value):
        self.value = deepcopy(value)
        self.exists = value is not None

    def to_dict(self):
        return deepcopy(self.value)


class Reference:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def get(self, transaction):
        if transaction.ops:
            raise AssertionError('Firestore does not permit transactional reads after writes')
        return Snapshot(self.db.docs.get(self.path))


class Collection:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, identifier):
        return Reference(self.db, self.path + '/' + identifier)


class UserReference:
    def __init__(self, db, uid):
        self.db, self.uid = db, uid

    def collection(self, kind):
        return Collection(self.db, 'users/' + self.uid + '/' + kind)


class UsersCollection:
    def __init__(self, db):
        self.db = db

    def document(self, uid):
        return UserReference(self.db, uid)


class Database:
    def __init__(self):
        self.docs = {}

    def collection(self, name):
        assert name == 'users'
        return UsersCollection(self)

    def transaction(self):
        return Transaction(self)


class Transaction:
    def __init__(self, db):
        self.db, self.ops = db, []

    def set(self, ref, value):
        self.ops.append(('set', ref.path, deepcopy(value)))

    def create(self, ref, value):
        self.ops.append(('create', ref.path, deepcopy(value)))

    def delete(self, ref):
        self.ops.append(('delete', ref.path, None))

    def commit(self):
        clone = deepcopy(self.db.docs)
        for op, path, value in self.ops:
            if op == 'create' and path in clone:
                raise AssertionError('Create must not overwrite an existing record')
            if op == 'delete':
                clone.pop(path, None)
            else:
                clone[path] = value
        self.db.docs = clone


@pytest.fixture
def firestore_store(monkeypatch):
    # The production adapter imports firestore only inside its transactional methods.
    import google.cloud
    def transactional(callback):
        def invoke(tx):
            result = callback(tx)
            tx.commit()
            return result
        return invoke
    monkeypatch.setattr(google.cloud, 'firestore', SimpleNamespace(transactional=transactional), raising=False)
    store = FirestoreStore.__new__(FirestoreStore)
    store.db = Database()
    return store


def test_focus_lifecycle_is_atomic_and_guarded(firestore_store):
    store = firestore_store
    doc = {'id': 'one', 'status': 'running', 'started_at': 10}
    store.start_focus_atomic('alice', doc)
    with pytest.raises(ActiveSessionExists):
        store.start_focus_atomic('alice', {'id': 'two', 'status': 'running', 'started_at': 11})
    assert len(store.db.docs) == 2

    paused = store.update_focus_atomic('alice', 'one', lambda d: {**d, 'status': 'paused'})
    assert paused['status'] == 'paused'
    store.update_focus_atomic('alice', 'one', lambda d: {**d, 'status': 'finished'})
    assert store.guard_ref('alice').path not in store.db.docs
    store.start_focus_atomic('alice', {'id': 'two', 'status': 'running', 'started_at': 50})
    store.delete_focus_atomic('alice', 'two')
    assert store.guard_ref('alice').path not in store.db.docs


def test_atomic_recurrence_and_no_partial_commit(firestore_store):
    store = firestore_store
    parent = store.col('alice', 'items').document('one')
    store.db.docs[parent.path] = {'id': 'one', 'done': False}

    def update(original):
        return {**original, 'done': True}, {'id': 'two', 'done': False}

    assert store.update_item_atomic('alice', 'one', update)['done'] is True
    assert len(store.db.docs) == 2
    assert store.update_item_atomic('alice', 'one', update)['done'] is True
    assert len(store.db.docs) == 2

    def fail(original):
        raise ValueError('invalid mutation')

    with pytest.raises(ValueError):
        store.update_item_atomic('alice', 'one', fail)
    assert store.db.docs[parent.path] == {'id': 'one', 'done': True}


def test_focus_guard_mismatch_is_rejected_without_writes(firestore_store):
    store = firestore_store
    store.db.docs[store.col('alice', 'sessions').document('old').path] = {
        'id': 'old', 'status': 'running', 'started_at': 1,
    }
    with pytest.raises(SessionStateConflict):
        store.update_focus_atomic('alice', 'old', lambda e: {**e, 'status': 'finished'})
    with pytest.raises(DocumentMissing):
        store.update_focus_atomic('alice', 'absent', lambda e: e)
    assert len(store.db.docs) == 1
