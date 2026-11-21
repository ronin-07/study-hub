"""Simple per-user document storage. SQLite for localhost; Firestore in configured deployment."""
import json
import os
import sqlite3
from pathlib import Path
from threading import RLock
from typing import Any


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

    def delete(self, uid: str, kind: str, identifier: str):
        with self.lock, self.connect() as db:
            db.execute('DELETE FROM documents WHERE uid=? AND kind=? AND id=?', (uid, kind, identifier))
            db.commit()


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

    def delete(self, uid, kind, identifier):
        self.col(uid, kind).document(identifier).delete()


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
