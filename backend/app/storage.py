"""Simple per-user document storage. SQLite for localhost; Firestore in configured deployment."""
from __future__ import annotations
import json
import logging
from contextvars import ContextVar
import os
import sqlite3
from pathlib import Path
from threading import RLock
from typing import Any, Callable


# Request-local estimates only; never log identifiers or document contents.
DB_DIAGNOSTICS = ContextVar('studyhub_db_diagnostics', default=None)
_db_log = logging.getLogger('studyhub.database')


def count_db(kind: str, amount: int = 1):
    counters = DB_DIAGNOSTICS.get()
    if counters is not None:
        # The same request may issue concurrent asyncio.to_thread queries.
        with counters['lock']:
            counters[kind] = counters.get(kind, 0) + amount


def check_document_size(kind: str, doc: dict):
    if DB_DIAGNOSTICS.get() is None:
        return
    size = len(json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    if size >= 256 * 1024:
        _db_log.warning('Firestore serialized document size estimate: collection=%s bytes=%d level=%s',
                        kind, size, 'high' if size >= 512 * 1024 else 'warning')


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


def recorded_focus_seconds(session: dict[str, Any]) -> int:
    """Only positive-duration finished sessions count toward study statistics."""
    if session.get('status') != 'finished':
        return 0
    return max(0, int(session.get('focus_seconds') or 0))


class WorkspaceView:
    """Read latest workspace state and stage writes within one database transaction.

    The Firestore adapter *stages* writes until all reads have completed: Firestore
    transactions forbid reads after a write. The SQLite adapter shares this behavior.
    """

    def __init__(self, fetch, scan, scan_equal=None):
        self._fetch, self._scan = fetch, scan
        self._scan_equal = scan_equal
        self._filtered: dict[tuple, list[dict[str, Any]]] = {}
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
                self._cache[key] = (next((row for row in self._collections[kind] if row['id'] == identifier), None)
                                    if kind in self._collections else self._fetch(kind, identifier))
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

    def list_equal(self, kind: str, field: str, value: str) -> list[dict[str, Any]]:
        if kind in self._collections or self._scan_equal is None:
            return [row for row in self.list(kind) if row.get(field) == value]
        key = (kind, field, value)
        if key not in self._filtered:
            self._filtered[key] = self._scan_equal(kind, field, value)
            for row in self._filtered[key]:
                self._cache[(kind, row['id'])] = row
        rows = {row['id']: dict(row) for row in self._filtered[key]}
        for (changed_kind, identifier), doc in self._writes.items():
            if changed_kind == kind:
                if doc is None or doc.get(field) != value:
                    rows.pop(identifier, None)
                else:
                    rows[identifier] = dict(doc)
        return list(rows.values())

    def create_generated(self, kind: str, doc: dict[str, Any]) -> None:
        # Server-generated UUIDs do not need a separate existence lookup;
        # both stores enforce a create-only precondition at commit.
        key = (kind, doc['id'])
        if key in self._writes or self._cache.get(key) is not None:
            raise DocumentAlreadyExists
        self._creates.add(key)
        self._writes[key] = dict(doc)

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


    def sync_index(self, uid: str, desired: dict[str, dict[str, Any]]) -> dict[str, int]:
        """Apply a full Drive index diff in one SQLite transaction."""
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            rows = db.execute('SELECT id,payload FROM documents WHERE uid=? AND kind=?',
                              (uid, 'drive-index')).fetchall()
            before = {row['id']: json.loads(row['payload']) for row in rows}
            removed = set(before) - set(desired)
            changed = {k: v for k, v in desired.items() if before.get(k) != v}
            for identifier in removed:
                db.execute('DELETE FROM documents WHERE uid=? AND kind=? AND id=?',
                           (uid, 'drive-index', identifier))
            for identifier, doc in changed.items():
                db.execute('INSERT OR REPLACE INTO documents VALUES (?,?,?,?)',
                           (uid, 'drive-index', identifier, json.dumps(doc)))
        return {'added': len(set(changed) - set(before)),
                'updated': len(set(changed) & set(before)), 'removed': len(removed)}

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

            def scan_equal(kind, field, value):
                rows = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND json_extract(payload, ?) = ?',
                                  (uid, kind, '$.' + field, value)).fetchall()
                return [json.loads(row['payload']) for row in rows]

            view = WorkspaceView(fetch, scan, scan_equal)
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

    def update_item_atomic(self, uid: str, identifier: str, mutate: ItemMutation, *, successor_lookup=None):
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
            if successor_lookup is not None:
                successor_id = successor['id'] if successor else successor_lookup(updated)
                row = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                                 (uid, 'items', successor_id)).fetchone() if successor_id else None
                return updated, json.loads(row['payload']) if row else None
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

    @staticmethod
    def _focus_totals(db, uid: str) -> dict[str, Any]:
        """Read or initialize a private aggregate inside the existing SQLite transaction."""
        row = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=? AND id=?',
                         (uid, 'focus_summary', 'state')).fetchone()
        if row:
            return json.loads(row['payload'])
        entries = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=?',
                             (uid, 'sessions')).fetchall()
        completed = [json.loads(r['payload']) for r in entries]
        completed = [s for s in completed if recorded_focus_seconds(s) > 0]
        return {'id': 'state', 'total_seconds': sum(recorded_focus_seconds(s) for s in completed),
                'completed_sessions': len(completed)}

    @staticmethod
    def _write_focus_totals(db, uid: str, stats: dict[str, Any]) -> None:
        db.execute('INSERT OR REPLACE INTO documents VALUES (?,?,?,?)',
                   (uid, 'focus_summary', 'state', json.dumps(stats)))

    def focus_overview(self, uid: str, week_start: int) -> dict[str, Any]:
        """One compact view; SQLite scans remain local and do not cost cloud reads."""
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            stats = self._focus_totals(db, uid)
            self._write_focus_totals(db, uid, stats)
            rows = db.execute('SELECT payload FROM documents WHERE uid=? AND kind=?',
                              (uid, 'sessions')).fetchall()
            sessions = [json.loads(r['payload']) for r in rows]
        finished = sorted((s for s in sessions if recorded_focus_seconds(s) > 0),
                          key=lambda s: s.get('ended_at') or 0, reverse=True)
        chosen = {s['id']: s for s in finished[:5]}
        for s in finished:
            if (s.get('ended_at') or 0) >= week_start:
                chosen[s['id']] = s
        for s in sessions:
            if s.get('status') in ('running', 'paused'):
                chosen[s['id']] = s
        return {'sessions': list(chosen.values()), 'focus_stats': stats}

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
            previous_status = entry['status']
            updated = mutate(entry)
            if previous_status != 'finished' and recorded_focus_seconds(updated) > 0:
                stats = self._focus_totals(db, uid)
                stats['total_seconds'] += recorded_focus_seconds(updated)
                stats['completed_sessions'] += 1
                self._write_focus_totals(db, uid, stats)
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
            if recorded_focus_seconds(entry) > 0:
                stats = self._focus_totals(db, uid)
                stats['total_seconds'] = max(0, stats['total_seconds'] - recorded_focus_seconds(entry))
                stats['completed_sessions'] = max(0, stats['completed_sessions'] - 1)
                self._write_focus_totals(db, uid, stats)
            db.execute('DELETE FROM documents WHERE uid=? AND kind=? AND id=?',
                       (uid, 'sessions', identifier))


class FirestoreStore:
    def __init__(self):
        from firebase_admin import firestore
        self.db = firestore.client()

    def col(self, uid, kind):
        return self.db.collection('users').document(uid).collection('studyhub_' + kind)

    def list(self, uid, kind):
        rows = [s.to_dict() for s in self.col(uid, kind).stream()]
        count_db('queries'); count_db('query_documents', len(rows))
        return rows

    def get(self, uid, kind, identifier):
        count_db('point_reads')
        snap = self.col(uid, kind).document(identifier).get()
        return snap.to_dict() if snap.exists else None

    def put(self, uid, kind, doc):
        check_document_size(kind, doc)
        self.col(uid, kind).document(doc['id']).set(doc)
        count_db('writes')

    def create(self, uid, kind, doc):
        from google.api_core.exceptions import AlreadyExists, Conflict
        try:
            check_document_size(kind, doc)
            self.col(uid, kind).document(doc['id']).create(doc)
            count_db('writes')
        except (AlreadyExists, Conflict) as exc:
            raise DocumentAlreadyExists from exc

    def delete(self, uid, kind, identifier):
        self.col(uid, kind).document(identifier).delete()
        count_db('deletes')


    def guard_ref(self, uid):
        return self.db.collection('users').document(uid).collection('studyhub_focus_guard').document('active')

    def sync_index(self, uid: str, desired: dict[str, dict[str, Any]]) -> dict[str, int]:
        """Write only changed Drive metadata, batching up to 400 writes per RPC."""
        previous = {doc['id']: doc for doc in self.list(uid, 'drive-index')}
        removed = set(previous) - set(desired)
        changed = {k: v for k, v in desired.items() if previous.get(k) != v}
        writes = [('delete', key, None) for key in removed]
        writes += [('set', key, doc) for key, doc in changed.items()]
        collection = self.col(uid, 'drive-index')
        for offset in range(0, len(writes), 400):
            batch = self.db.batch()
            for method, key, doc in writes[offset:offset+400]:
                ref = collection.document(key)
                if method == 'delete':
                    batch.delete(ref)
                else:
                    batch.set(ref, doc)
            batch.commit()
        return {'added': len(set(changed) - set(previous)),
                'updated': len(set(changed) & set(previous)), 'removed': len(removed)}

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
            count_db('point_reads')
            lock = lock_ref.get(transaction=tx)
            revision = int((lock.to_dict() or {}).get('revision', 0)) if lock.exists else 0

            def fetch(kind, identifier):
                count_db('point_reads')
                snapshot = self.col(uid, kind).document(identifier).get(transaction=tx)
                return snapshot.to_dict() if snapshot.exists else None

            def scan(kind):
                # Firestore query reads MUST precede the first transaction write.
                rows = [snap.to_dict() for snap in self.col(uid, kind).stream(transaction=tx)]
                count_db('queries'); count_db('query_documents', len(rows))
                return rows

            def scan_equal(kind, field, value):
                rows = [snap.to_dict() for snap in self.col(uid, kind).where(field, '==', value).stream(transaction=tx)]
                count_db('queries'); count_db('query_documents', len(rows))
                return rows

            view = WorkspaceView(fetch, scan, scan_equal)
            result = mutate(view)
            if not view._writes:
                return result
            if len(view._writes) + 1 > 500:
                raise ValueError('Workspace transaction exceeds Firestore 500-write limit')
            for (kind, identifier), doc in view._writes.items():
                ref = self.col(uid, kind).document(identifier)
                if doc is None:
                    tx.delete(ref)
                    count_db('staged_deletes')
                else:
                    check_document_size(kind, doc)
                    if (kind, identifier) in view._creates:
                        tx.create(ref, doc)
                    else:
                        tx.set(ref, doc)
                    count_db('staged_writes')
            count_db('staged_writes')
            tx.set(lock_ref, {'id': 'state', 'revision': revision + 1})
            return result

        return operation(transaction)

    def update_item_atomic(self, uid: str, identifier: str, mutate: ItemMutation, *, successor_lookup=None):
        from google.cloud import firestore
        original_ref = self.col(uid, 'items').document(identifier)
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            count_db('point_reads')
            snap = original_ref.get(transaction=tx)
            if not snap.exists:
                raise DocumentMissing
            updated, successor = mutate(snap.to_dict())
            successor_id = successor['id'] if successor else successor_lookup(updated) if successor_lookup else None
            new_ref = self.col(uid, 'items').document(successor_id) if successor_id else None
            if new_ref:
                count_db('point_reads')
            next_snap = new_ref.get(transaction=tx) if new_ref else None
            successor_exists = next_snap is not None and next_snap.exists
            # No reads after the first transactional write.
            check_document_size('items', updated)
            tx.set(original_ref, updated)
            count_db('staged_writes')
            if successor is not None and new_ref and not successor_exists:
                check_document_size('items', successor)
                tx.create(new_ref, successor)
                count_db('staged_writes')
            if successor_lookup is not None:
                return updated, next_snap.to_dict() if successor_exists else successor
            return updated

        return operation(transaction)

    def start_focus_atomic(self, uid: str, doc: dict[str, Any]) -> dict[str, Any]:
        from google.cloud import firestore
        active_ref = self.guard_ref(uid)
        session_ref = self.col(uid, 'sessions').document(doc['id'])
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            count_db('point_reads')
            active = active_ref.get(transaction=tx)
            count_db('point_reads')
            session = session_ref.get(transaction=tx)
            if active.exists:
                raise ActiveSessionExists
            if session.exists:
                raise DocumentAlreadyExists
            if doc.get('course_id'):
                count_db('point_reads')
                course = self.col(uid, 'courses').document(doc['course_id']).get(transaction=tx)
                if not course.exists or course.to_dict().get('archived'):
                    raise SessionStateConflict
            tx.create(session_ref, doc)
            count_db('staged_writes')
            tx.create(active_ref, {'id': 'active', 'session_id': doc['id']})
            count_db('staged_writes')
            return doc

        return operation(transaction)

    def _focus_stats_in_tx(self, tx, uid: str, stats_ref) -> dict[str, Any]:
        """Migrate legacy session history once, with a transactional read barrier."""
        count_db('point_reads')
        stats_snap = stats_ref.get(transaction=tx)
        if stats_snap.exists:
            return stats_snap.to_dict()
        completed = [snap.to_dict() for snap in self.col(uid, 'sessions').stream(transaction=tx)]
        count_db('queries'); count_db('query_documents', len(completed))
        completed = [s for s in completed if recorded_focus_seconds(s) > 0]
        return {'id': 'state', 'total_seconds': sum(recorded_focus_seconds(s) for s in completed),
                'completed_sessions': len(completed)}

    def focus_overview(self, uid: str, week_start: int) -> dict[str, Any]:
        """Only read active, this week's, and five newest sessions from Firestore."""
        from google.cloud import firestore
        stats_ref = self.col(uid, 'focus_summary').document('state')
        transaction = self.db.transaction()

        @firestore.transactional
        def initialize(tx):
            count_db('point_reads')
            stats = stats_ref.get(transaction=tx)
            if stats.exists:
                return stats.to_dict()
            initial = self._focus_stats_in_tx(tx, uid, stats_ref)
            tx.create(stats_ref, initial)
            count_db('staged_writes')
            return initial

        # Existing accounts are initialized once; later requests read one document.
        stats = initialize(transaction)
        sessions = self.col(uid, 'sessions')
        weekly = sessions.where('ended_at', '>=', week_start).stream()
        picked: dict[str, dict[str, Any]] = {}
        count_db('queries')
        for snap in weekly:
            count_db('query_documents')
            s = snap.to_dict()
            if s and recorded_focus_seconds(s) > 0:
                picked[s['id']] = s
        if len(picked) < 5:
            # Preserve the existing five-newest semantics (including legacy invalid
            # sessions) for short weeks; avoid a redundant query otherwise.
            count_db('queries')
            for snap in sessions.order_by('ended_at', direction=firestore.Query.DESCENDING).limit(5).stream():
                count_db('query_documents')
                s = snap.to_dict()
                if s and recorded_focus_seconds(s) > 0:
                    picked[s['id']] = s
        count_db('point_reads')
        guard = self.guard_ref(uid).get()
        if guard.exists:
            identifier = (guard.to_dict() or {}).get('session_id')
            if identifier:
                count_db('point_reads')
                active = sessions.document(identifier).get()
                if active.exists:
                    s = active.to_dict()
                    if s.get('status') in ('running', 'paused'):
                        picked[s['id']] = s
        return {'sessions': list(picked.values()), 'focus_stats': stats}

    def update_focus_atomic(self, uid: str, identifier: str, mutate: FocusMutation) -> dict[str, Any]:
        from google.cloud import firestore
        session_ref = self.col(uid, 'sessions').document(identifier)
        active_ref = self.guard_ref(uid)
        stats_ref = self.col(uid, 'focus_summary').document('state')
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            count_db('point_reads')
            session = session_ref.get(transaction=tx)
            count_db('point_reads')
            active = active_ref.get(transaction=tx)
            if not session.exists:
                raise DocumentMissing
            entry = session.to_dict()
            if entry['status'] in ('running', 'paused') and (
                not active.exists or active.to_dict().get('session_id') != identifier
            ):
                raise SessionStateConflict
            updated = mutate(dict(entry))
            if entry['status'] != 'finished' and recorded_focus_seconds(updated) > 0:
                stats = self._focus_stats_in_tx(tx, uid, stats_ref)
                stats['total_seconds'] += recorded_focus_seconds(updated)
                stats['completed_sessions'] += 1
                tx.set(stats_ref, stats)
                count_db('staged_writes')
            tx.set(session_ref, updated)
            count_db('staged_writes')
            if updated['status'] == 'finished':
                tx.delete(active_ref)
                count_db('staged_deletes')
            return updated

        return operation(transaction)

    def delete_focus_atomic(self, uid: str, identifier: str) -> None:
        from google.cloud import firestore
        session_ref = self.col(uid, 'sessions').document(identifier)
        active_ref = self.guard_ref(uid)
        stats_ref = self.col(uid, 'focus_summary').document('state')
        transaction = self.db.transaction()

        @firestore.transactional
        def operation(tx):
            count_db('point_reads')
            session = session_ref.get(transaction=tx)
            count_db('point_reads')
            active = active_ref.get(transaction=tx)
            if not session.exists:
                raise DocumentMissing
            entry = session.to_dict()
            if entry['status'] in ('running', 'paused'):
                if not active.exists or active.to_dict().get('session_id') != identifier:
                    raise SessionStateConflict
                tx.delete(active_ref)
                count_db('staged_deletes')
            if recorded_focus_seconds(entry) > 0:
                stats = self._focus_stats_in_tx(tx, uid, stats_ref)
                stats['total_seconds'] = max(0, stats['total_seconds'] - recorded_focus_seconds(entry))
                stats['completed_sessions'] = max(0, stats['completed_sessions'] - 1)
                tx.set(stats_ref, stats)
                count_db('staged_writes')
            tx.delete(session_ref)
            count_db('staged_deletes')

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
