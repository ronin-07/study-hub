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


class WorkspaceView:
    """Read latest workspace state and stage writes within one database transaction.

    The Firestore adapter *stages* writes until all reads have completed: Firestore
    transactions forbid reads after a write. The SQLite adapter shares this behavior.
    """

    def __init__(self, fetch, scan):
        self._fetch, self._scan = fetch, scan
        self._writes: dict[tuple[str, str], dict[str, Any] | None] = {}
        self._creates: set[tuple[str, str]] = set()
        self._cache: dict[tuple[str, str], dict[str, Any] | None] = {}
        self._collections: dict[str, list[dict[str, Any]]] = {}

    def get(self, kind: str, identifier: str) -> dict[str, Any] | None:
        key = (kind, identifier)
        if key in self._writes:
            doc = self._writes[key]
        else:
            if key not in self._cache:
                self._cache[key] = self._fetch(kind, identifier)
            doc = self._cache[key]
        return dict(doc) if doc is not None else None

    def list(self, kind: str) -> list[dict[str, Any]]:
        if kind not in self._collections:
            self._collections[kind] = self._scan(kind)
        rows = {doc['id']: dict(doc) for doc in self._collections[kind]}
        for (changed_kind, identifier), doc in self._writes.items():
            if changed_kind == kind:
                if doc is None:
                    rows.pop(identifier, None)
                else:
                    rows[identifier] = dict(doc)
        return list(rows.values())

    def create(self, kind: str, doc: dict[str, Any]) -> None:
        key = (kind, doc['id'])
        if self.get(*key) is not None:
            raise DocumentAlreadyExists
        self._creates.add(key)
        self._writes[key] = dict(doc)

    def put(self, kind: str, doc: dict[str, Any]) -> None:
        self._writes[(kind, doc['id'])] = dict(doc)

    def delete(self, kind: str, identifier: str) -> None:
        self._writes[(kind, identifier)] = None


WorkspaceMutation = Callable[[WorkspaceView], Any]


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


    def workspace_atomic(self, uid: str, mutate: WorkspaceMutation) -> Any:
        """Serialize workspace constraints across processes and commit all edits together."""
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')

            def fetch(kind, identifier):
                row = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                                 (uid, kind, identifier)).fetchone()
                return json.loads(row['payload']) if row else None

            def scan(kind):
                rows = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=?',
                                  (uid, kind)).fetchall()
                return [json.loads(row['payload']) for row in rows]

            view = WorkspaceView(fetch, scan)
            result = mutate(view)
            for (kind, identifier), doc in view._writes.items():
                if doc is None:
                    db.execute('DELETE FROM documents WHERE uid=? AND kind=? AND id=?',
                               (uid, kind, identifier))
                elif (kind, identifier) in view._creates:
                    try:
                        db.execute('INSERT INTO documents VALUES (?,?,?,?)',
                                   (uid, kind, identifier, json.dumps(doc)))
                    except sqlite3.IntegrityError as exc:
                        raise DocumentAlreadyExists from exc
                else:
                    db.execute('INSERT OR REPLACE INTO documents VALUES (?,?,?,?)',
                               (uid, kind, identifier, json.dumps(doc)))
        return result

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
            if doc.get('course_id'):
                course_row = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                                        (uid, 'courses', doc['course_id'])).fetchone()
                if not course_row or json.loads(course_row['payload']).get('archived'):
                    raise SessionStateConflict
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

    def workspace_atomic(self, uid: str, mutate: WorkspaceMutation) -> Any:
        """All structural checks and writes share one Firestore transaction.

        A per-user revision document serializes concurrent structural requests.
        Its version is read and rewritten in the same transaction. When two
        requests read the same version, Firestore retries one before committing.
        """
        from google.cloud import firestore
        lock_ref = self.col(uid, 'workspace_guard').document('state')
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            lock = lock_ref.get(transaction=tx)
            revision = int((lock.to_dict() or {}).get('revision', 0)) if lock.exists else 0

            def fetch(kind, identifier):
                snapshot = self.col(uid, kind).document(identifier).get(transaction=tx)
                return snapshot.to_dict() if snapshot.exists else None

            def scan(kind):
                # Firestore query reads MUST precede the first transaction write.
                return [snap.to_dict() for snap in self.col(uid, kind).stream(transaction=tx)]

            view = WorkspaceView(fetch, scan)
            result = mutate(view)
            if len(view._writes) + 1 > 500:
                raise ValueError('Workspace transaction exceeds Firestore 500-write limit')
            for (kind, identifier), doc in view._writes.items():
                ref = self.col(uid, kind).document(identifier)
                if doc is None:
                    tx.delete(ref)
                elif (kind, identifier) in view._creates:
                    tx.create(ref, doc)
                else:
                    tx.set(ref, doc)
            tx.set(lock_ref, {'id': 'state', 'revision': revision + 1})
            return result

        return operation(transaction)

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
            if doc.get('course_id'):
                course = self.col(uid, 'courses').document(doc['course_id']).get(transaction=tx)
                if not course.exists or course.to_dict().get('archived'):
                    raise SessionStateConflict
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
