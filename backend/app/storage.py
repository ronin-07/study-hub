"""Simple per-user document storage. SQLite for localhost; Firestore in configured deployment."""
import json
import os
import sqlite3
from pathlib import Path
from threading import RLock
from typing import Any, Callable


class DocumentAlreadyExists(Exception):
    """Create-only operation rejected a document ID that already exists."""


class DocumentMissing(Exception):
    """A record disappeared before its atomic update."""


class ActiveSessionExists(Exception):
    """An active focus slot is already occupied."""


class SessionStateConflict(Exception):
    """A session does not match the user's active focus slot."""


ItemMutation = Callable[[dict[str, Any]], tuple[dict[str, Any], dict[str, Any] | None]]
FocusMutation = Callable[[dict[str, Any]], dict[str, Any]]


class SQLiteStore:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        with self.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS documents (
              uid TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
              PRIMARY KEY(uid,kind,id))''')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        return db

    def list(self, uid: str, kind: str) -> list[dict[str, Any]]:
        with self.lock, self.connect() as db:
            rows = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? ORDER BY id', (uid, kind)).fetchall()
        return [json.loads(x['payload']) for x in rows]

    def get(self, uid: str, kind: str, identifier: str) -> dict[str, Any] | None:
        with self.lock, self.connect() as db:
            row = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?', (uid, kind, identifier)).fetchone()
        return json.loads(row['payload']) if row else None

    def put(self, uid: str, kind: str, doc: dict[str, Any]):
        with self.lock, self.connect() as db:
            db.execute('INSERT OR REPLACE INTO documents VALUES (?,?,?,?)', (uid, kind, doc['id'], json.dumps(doc)))
            db.commit()

    def create(self, uid: str, kind: str, doc: dict[str, Any]):
        with self.lock, self.connect() as db:
            try:
                db.execute('INSERT INTO documents VALUES (?,?,?,?)',
                           (uid, kind, doc['id'], json.dumps(doc)))
                db.commit()
            except sqlite3.IntegrityError as exc:
                raise DocumentAlreadyExists from exc

    def delete(self, uid: str, kind: str, identifier: str):
        with self.lock, self.connect() as db:
            db.execute('DELETE FROM documents WHERE uid=? AND kind=? AND id=?', (uid, kind, identifier))
            db.commit()


    def update_item_atomic(self, uid: str, identifier: str, mutate: ItemMutation) -> dict[str, Any]:
        """Serialize concurrent edits and successor creation, including across processes."""
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                             (uid, 'items', identifier)).fetchone()
            if row is None:
                raise DocumentMissing
            updated, successor = mutate(json.loads(row['payload']))
            if successor is not None:
                db.execute('INSERT OR IGNORE INTO documents VALUES (?,?,?,?)',
                           (uid, 'items', successor['id'], json.dumps(successor)))
            db.execute('UPDATE documents SET payload=? WHERE uid=? AND kind=? AND id=?',
                       (json.dumps(updated), uid, 'items', identifier))
        return updated

    def start_focus_atomic(self, uid: str, doc: dict[str, Any]) -> dict[str, Any]:
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            guard = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                               (uid, 'focus_guard', 'active')).fetchone()
            if guard:
                raise ActiveSessionExists
            db.execute('INSERT INTO documents VALUES (?,?,?,?)',
                       (uid, 'sessions', doc['id'], json.dumps(doc)))
            db.execute('INSERT INTO documents VALUES (?,?,?,?)',
                       (uid, 'focus_guard', 'active', json.dumps({'id': 'active', 'session_id': doc['id']})))
        return doc

    def update_focus_atomic(self, uid: str, identifier: str, mutate: FocusMutation) -> dict[str, Any]:
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                             (uid, 'sessions', identifier)).fetchone()
            if row is None:
                raise DocumentMissing
            guard = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                               (uid, 'focus_guard', 'active')).fetchone()
            entry = json.loads(row['payload'])
            if entry['status'] in ('running', 'paused') and (
                not guard or json.loads(guard['payload']).get('session_id') != identifier
            ):
                raise SessionStateConflict
            updated = mutate(entry)
            db.execute('UPDATE documents SET payload=? WHERE uid=? AND kind=? AND id=?',
                       (json.dumps(updated), uid, 'sessions', identifier))
            if updated['status'] == 'finished':
                db.execute('DELETE FROM documents WHERE uid=? AND kind=? AND id=?',
                           (uid, 'focus_guard', 'active'))
        return updated

    def delete_focus_atomic(self, uid: str, identifier: str) -> None:
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                             (uid, 'sessions', identifier)).fetchone()
            if row is None:
                raise DocumentMissing
            entry = json.loads(row['payload'])
            guard = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                               (uid, 'focus_guard', 'active')).fetchone()
            if entry['status'] in ('running', 'paused'):
                if not guard or json.loads(guard['payload']).get('session_id') != identifier:
                    raise SessionStateConflict
                db.execute('DELETE FROM documents WHERE uid=? AND kind=? AND id=?',
                           (uid, 'focus_guard', 'active'))
            db.execute('DELETE FROM documents WHERE uid=? AND kind=? AND id=?',
                       (uid, 'sessions', identifier))


class FirestoreStore:
    def __init__(self):
        from firebase_admin import firestore
        self.db = firestore.client()

    def col(self, uid, kind):
        return self.db.collection('users').document(uid).collection('studyhub_' + kind)

    def list(self, uid, kind):
        return [s.to_dict() for s in self.col(uid, kind).stream()]

    def get(self, uid, kind, identifier):
        snap = self.col(uid, kind).document(identifier).get()
        return snap.to_dict() if snap.exists else None

    def put(self, uid, kind, doc):
        self.col(uid, kind).document(doc['id']).set(doc)

    def create(self, uid, kind, doc):
        from google.api_core.exceptions import AlreadyExists, Conflict
        try:
            self.col(uid, kind).document(doc['id']).create(doc)
        except (AlreadyExists, Conflict) as exc:
            raise DocumentAlreadyExists from exc

    def delete(self, uid, kind, identifier):
        self.col(uid, kind).document(identifier).delete()


    def guard_ref(self, uid):
        return self.db.collection('users').document(uid).collection('studyhub_focus_guard').document('active')

    def update_item_atomic(self, uid: str, identifier: str, mutate: ItemMutation) -> dict[str, Any]:
        from google.cloud import firestore
        original_ref = self.col(uid, 'items').document(identifier)
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            snap = original_ref.get(transaction=tx)
            if not snap.exists:
                raise DocumentMissing
            updated, successor = mutate(snap.to_dict())
            new_ref = self.col(uid, 'items').document(successor['id']) if successor else None
            successor_exists = new_ref.get(transaction=tx).exists if new_ref else False
            # No reads after the first transactional write.
            tx.set(original_ref, updated)
            if new_ref and not successor_exists:
                tx.create(new_ref, successor)
            return updated

        return operation(transaction)

    def start_focus_atomic(self, uid: str, doc: dict[str, Any]) -> dict[str, Any]:
        from google.cloud import firestore
        active_ref = self.guard_ref(uid)
        session_ref = self.col(uid, 'sessions').document(doc['id'])
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            active = active_ref.get(transaction=tx)
            session = session_ref.get(transaction=tx)
            if active.exists:
                raise ActiveSessionExists
            if session.exists:
                raise DocumentAlreadyExists
            tx.create(session_ref, doc)
            tx.create(active_ref, {'id': 'active', 'session_id': doc['id']})
            return doc

        return operation(transaction)

    def update_focus_atomic(self, uid: str, identifier: str, mutate: FocusMutation) -> dict[str, Any]:
        from google.cloud import firestore
        session_ref = self.col(uid, 'sessions').document(identifier)
        active_ref = self.guard_ref(uid)
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            session = session_ref.get(transaction=tx)
            active = active_ref.get(transaction=tx)
            if not session.exists:
                raise DocumentMissing
            entry = session.to_dict()
            if entry['status'] in ('running', 'paused') and (
                not active.exists or active.to_dict().get('session_id') != identifier
            ):
                raise SessionStateConflict
            updated = mutate(entry)
            tx.set(session_ref, updated)
            if updated['status'] == 'finished':
                tx.delete(active_ref)
            return updated

        return operation(transaction)

    def delete_focus_atomic(self, uid: str, identifier: str) -> None:
        from google.cloud import firestore
        session_ref = self.col(uid, 'sessions').document(identifier)
        active_ref = self.guard_ref(uid)
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            session = session_ref.get(transaction=tx)
            active = active_ref.get(transaction=tx)
            if not session.exists:
                raise DocumentMissing
            entry = session.to_dict()
            if entry['status'] in ('running', 'paused'):
                if not active.exists or active.to_dict().get('session_id') != identifier:
                    raise SessionStateConflict
                tx.delete(active_ref)
            tx.delete(session_ref)

        operation(transaction)


def get_store():
    backend = os.getenv('STORAGE_BACKEND', 'sqlite')
    if os.getenv('VERCEL') and (backend != 'firestore' or os.getenv('STUDY_HUB_AUTH_MODE') != 'firebase'):
        # Never persist private study records in an ephemeral serverless SQLite file,
        # or accidentally expose the local-only bypass on a public deployment.
        raise RuntimeError('Vercel requires STORAGE_BACKEND=firestore and STUDY_HUB_AUTH_MODE=firebase')
    if backend == 'firestore':
        return FirestoreStore()
    if backend != 'sqlite':
        raise RuntimeError('Unknown STORAGE_BACKEND')
    return SQLiteStore(os.getenv('SQLITE_PATH', './data/studyhub.sqlite3'))
