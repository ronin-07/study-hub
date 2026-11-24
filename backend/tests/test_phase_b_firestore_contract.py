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

    def get(self, transaction=None):
        if transaction is not None and transaction.ops:
            raise AssertionError('Firestore does not permit transactional reads after writes')
        return Snapshot(self.db.docs.get(self.path))


class Collection:
    def __init__(self, db, path, filters=(), ordering=None, maximum=None):
        self.db, self.path, self.filters = db, path, filters
        self.ordering, self.maximum = ordering, maximum

    def where(self, field, op, value):
        assert op in ('==', '>=')
        return Collection(self.db, self.path, self.filters + ((field, op, value),), self.ordering, self.maximum)

    def order_by(self, field, direction):
        return Collection(self.db, self.path, self.filters, (field, direction), self.maximum)

    def limit(self, maximum):
        return Collection(self.db, self.path, self.filters, self.ordering, maximum)

    def document(self, identifier):
        return Reference(self.db, self.path + '/' + identifier)

    def stream(self, transaction=None):
        if transaction is not None and transaction.ops:
            raise AssertionError('Firestore does not permit transactional reads after writes')
        prefix = self.path + '/'
        rows = [value for path, value in sorted(self.db.docs.items())
                if path.startswith(prefix) and '/' not in path[len(prefix):]
                and all(value.get(k) == v if op == '==' else value.get(k) is not None and value[k] >= v
                        for k, op, v in self.filters)]
        if self.ordering:
            field, direction = self.ordering
            rows = sorted((r for r in rows if r.get(field) is not None), key=lambda r:r[field], reverse=direction=='DESCENDING')
        for value in rows[:self.maximum]:
            yield Snapshot(value)


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
    monkeypatch.setattr(google.cloud, 'firestore', SimpleNamespace(transactional=transactional, Query=SimpleNamespace(DESCENDING='DESCENDING')), raising=False)
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


def test_workspace_transaction_stages_reads_before_writes(firestore_store):
    store = firestore_store
    first = {'id': 'one', 'name': 'Spring 2027'}
    second = {'id': 'two', 'name': 'Autumn 2027'}

    def create_first(tx):
        assert tx.list('semesters') == []
        tx.create('semesters', first)
        # Staged read works without doing a cloud read after the first write.
        assert tx.get('semesters', 'one') == first
        tx.create('semesters', second)

    store.workspace_atomic('alice', create_first)
    assert sorted(row['name'] for row in store.list('alice', 'semesters')) == sorted([
        'Spring 2027', 'Autumn 2027'])
    guard = store.col('alice', 'workspace_guard').document('state').path
    assert store.db.docs[guard]['revision'] == 1

    def rename(tx):
        sem = tx.get('semesters', 'one')
        tx.put('semesters', {**sem, 'name': 'New Spring'})
        assert len(tx.list('semesters')) == 2

    store.workspace_atomic('alice', rename)
    assert store.get('alice', 'semesters', 'one')['name'] == 'New Spring'
    assert store.db.docs[guard]['revision'] == 2


def test_workspace_transaction_rollback_no_partial_firestore(firestore_store):
    store = firestore_store
    store.workspace_atomic('alice', lambda tx: tx.create('semesters', {'id': 'one', 'name': 'Spring'}))
    prior = deepcopy(store.db.docs)

    def bad_update(tx):
        tx.put('semesters', {'id': 'one', 'name': 'Changed'})
        tx.create('courses', {'id': 'x', 'semester_id': 'one'})
        raise RuntimeError('Stop before commit')

    with pytest.raises(RuntimeError):
        store.workspace_atomic('alice', bad_update)
    assert store.db.docs == prior
