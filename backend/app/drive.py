"""Google Drive OAuth for a single-user private app; encrypted tokens never leave backend."""
from __future__ import annotations
import asyncio

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import RedirectResponse, Response, StreamingResponse

from .security import User, current_user
from .deployment import require_drive_available

router = APIRouter(prefix='/api/drive', tags=['drive'])
GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
DRIVE_ID = re.compile(r'^[A-Za-z0-9_-]{5,200}$')
PDF_CHECKSUM = re.compile(r'[a-f0-9]{64}')
MAX_PREVIEW_BYTES = 50 * 1024 * 1024
PRIVATE_PDF_HEADERS = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}


def _config():
    require_drive_available()
    keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'APP_SIGNING_SECRET', 'OAUTH_ENCRYPTION_KEY']
    missing = [x for x in keys if not os.getenv(x)]
    if missing:
        raise HTTPException(503, 'Google Drive integration is not configured: ' + ', '.join(missing))
    return {x: os.environ[x] for x in keys}


def _state(uid: str, secret: str):
    data = json.dumps({'uid': uid, 'ts': int(time.time()), 'nonce': secrets.token_urlsafe(24)}, separators=(',', ':')).encode()
    payload = base64.urlsafe_b64encode(data).decode().rstrip('=')
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return payload + '.' + sig


def _decode_claims(value: str, secret: str) -> dict:
    try:
        payload, signature = value.rsplit('.', 1)
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError('Bad signature')
        data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        if not 0 <= time.time() - data['ts'] < 600:
            raise ValueError('Expired')
        return data
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(400, 'Invalid or expired OAuth state') from None


def _decode_state(value: str, secret: str) -> str:
    return _decode_claims(value, secret)['uid']

def _token(store, uid: str, config):
    saved = store.get(uid, 'secrets', 'drive-token')
    if not saved:
        raise HTTPException(409, 'Google Drive not connected')
    try:
        return json.loads(Fernet(config['OAUTH_ENCRYPTION_KEY']).decrypt(saved['blob'].encode()))
    except Exception:
        raise HTTPException(409, 'Stored Google Drive credentials cannot be decrypted') from None


def _save_token(store, uid, config, token):
    encrypted = Fernet(config['OAUTH_ENCRYPTION_KEY']).encrypt(json.dumps(token).encode()).decode()
    store.put(uid, 'secrets', {'id': 'drive-token', 'blob': encrypted})


async def access_token(store, uid):
    cfg = _config()
    token = await asyncio.to_thread(_token, store, uid, cfg)
    if token.get('expires_at', 0) < time.time() + 90:
        if not token.get('refresh_token'):
            raise HTTPException(409, 'Google authorization has expired; reconnect Drive')
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(GOOGLE_TOKEN, data={
                'client_id': cfg['GOOGLE_CLIENT_ID'], 'client_secret': cfg['GOOGLE_CLIENT_SECRET'],
                'grant_type': 'refresh_token', 'refresh_token': token['refresh_token']
            })
        if response.status_code != 200:
            raise HTTPException(409, 'Google authorization expired or was revoked; reconnect Drive')
        refreshed = response.json()
        token['access_token'] = refreshed['access_token']
        token['expires_at'] = int(time.time()) + int(refreshed.get('expires_in', 3600))
        await asyncio.to_thread(_save_token, store, uid, cfg, token)
    return token['access_token']


def _store():
    from .main import app_store
    return app_store


@router.get('/status')
async def status(user: User = Depends(current_user)):
    store = _store()
    saved = await asyncio.to_thread(store.get, user.uid, 'secrets', 'drive-token')
    return {'connected': bool(saved),
            'configured': not (os.getenv('VERCEL_ENV') == 'preview' and os.getenv('STUDY_HUB_ALLOW_PREVIEW_DRIVE_OAUTH') != 'true') and all(os.getenv(x) for x in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'APP_SIGNING_SECRET', 'OAUTH_ENCRYPTION_KEY'))}


@router.get('/connect')
async def connect(user: User = Depends(current_user)):
    cfg = _config()
    state = _state(user.uid, cfg['APP_SIGNING_SECRET'])
    store = _store()
    # One-time, server-recorded challenge to prevent OAuth state replay.
    challenge_id = hashlib.sha256(state.encode()).hexdigest()
    for old in store.list(user.uid, 'oauth-challenges'):
        if old.get('created_at', 0) < time.time() - 900:
            store.delete(user.uid, 'oauth-challenges', old['id'])
    store.put(user.uid, 'oauth-challenges', {'id': challenge_id, 'created_at': int(time.time())})
    return {'authorization_url': GOOGLE_AUTH + '?' + urlencode({
        'client_id': cfg['GOOGLE_CLIENT_ID'], 'redirect_uri': cfg['GOOGLE_REDIRECT_URI'],
        'response_type': 'code', 'scope': SCOPE, 'access_type': 'offline',
        'include_granted_scopes': 'true', 'prompt': 'consent',
        'state': state
    })}


@router.get('/callback')
async def callback(code: str | None = None, state: str | None = None, error: str | None = None):
    cfg = _config()
    if error or not code or not state:
        raise HTTPException(400, 'Google authorization was cancelled or incomplete')
    uid = _decode_state(state, cfg['APP_SIGNING_SECRET'])
    store = _store()
    challenge_id = hashlib.sha256(state.encode()).hexdigest()
    challenge = store.get(uid, 'oauth-challenges', challenge_id)
    if not challenge or challenge.get('created_at', 0) < time.time() - 600:
        raise HTTPException(400, 'OAuth request was not initiated here, expired or already used')
    store.delete(uid, 'oauth-challenges', challenge_id)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(GOOGLE_TOKEN, data={
            'code': code, 'client_id': cfg['GOOGLE_CLIENT_ID'],
            'client_secret': cfg['GOOGLE_CLIENT_SECRET'],
            'redirect_uri': cfg['GOOGLE_REDIRECT_URI'], 'grant_type': 'authorization_code'
        })
    if response.status_code != 200:
        raise HTTPException(400, 'Google rejected the authorization code')
    result = response.json()
    if not result.get('refresh_token'):
        raise HTTPException(409, 'No refresh token returned. Reconnect with consent.')
    _save_token(_store(), uid, cfg, {
        'access_token': result['access_token'], 'refresh_token': result['refresh_token'],
        'expires_at': int(time.time()) + int(result.get('expires_in', 3600))
    })
    return RedirectResponse(os.getenv('WEB_URL', 'http://localhost:3000') + '/?drive=connected', status_code=303)


@router.get('/files')
async def files(folder_id: str = 'root', page_token: str | None = None, user: User = Depends(current_user)):
    if folder_id != 'root' and not DRIVE_ID.fullmatch(folder_id):
        raise HTTPException(400, 'Invalid folder ID')
    if page_token and len(page_token) > 1000:
        raise HTTPException(400, 'Invalid page token')
    token = await access_token(_store(), user.uid)
    params = {
        'q': f"'{folder_id}' in parents and trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/vnd.google-apps.folder')",
        'fields': 'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,parents)',
        'pageSize': 100, 'orderBy': 'folder,name',
    }
    if page_token:
        params['pageToken'] = page_token
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(DRIVE_FILES, params=params, headers={'Authorization': f'Bearer {token}'})
    if response.status_code != 200:
        raise HTTPException(502, f'Google Drive list failed ({response.status_code})')
    return response.json()


@router.get('/files/{file_id}/pdf')
async def pdf(file_id: str, user: User = Depends(current_user), if_none_match: str | None = Header(default=None)):
    """Authorize every open and stream the bytes only when the client needs them."""
    if not DRIVE_ID.fullmatch(file_id):
        raise HTTPException(400, 'Invalid Google Drive file ID')
    token = await access_token(_store(), user.uid)
    headers = {'Authorization': f'Bearer {token}'}
    url = f'{DRIVE_FILES}/{file_id}'
    client = httpx.AsyncClient(timeout=90, follow_redirects=False)
    upstream = None
    streaming = False
    try:
        meta = await client.get(url, params={'fields': 'mimeType,size,trashed,capabilities(canDownload),sha256Checksum'},
                                headers=headers, timeout=30)
        if meta.status_code != 200:
            raise HTTPException(404, 'Cannot access this Google Drive file')
        info = meta.json()
        if info.get('trashed'):
            raise HTTPException(404, 'Cannot access this Google Drive file')
        if info.get('mimeType') != 'application/pdf':
            raise HTTPException(415, 'Only PDFs may be previewed')
        can_download = (info.get('capabilities') or {}).get('canDownload')
        if can_download is False:
            raise HTTPException(403, 'Google Drive does not permit downloading this PDF')
        size = int(info.get('size') or 0)
        if size > MAX_PREVIEW_BYTES:
            raise HTTPException(413, 'PDF exceeds the 50 MB preview limit')
        checksum = str(info.get('sha256Checksum') or '').lower()
        etag = f'"sha256-{checksum}"' if can_download is True and size > 0 and PDF_CHECKSUM.fullmatch(checksum) else None
        response_headers = {**PRIVATE_PDF_HEADERS, 'Content-Disposition': 'inline'}
        if etag:
            response_headers['ETag'] = etag
            if if_none_match == etag:
                return Response(status_code=304, headers=response_headers)
            response_headers['Content-Length'] = str(size)

        request = client.build_request('GET', url, params={'alt': 'media'}, headers=headers)
        upstream = await client.send(request, stream=True)
        if upstream.status_code != 200:
            raise HTTPException(502, f'Could not retrieve PDF ({upstream.status_code})')
        chunks = upstream.aiter_bytes(chunk_size=65536)
        first = await anext(chunks, b'')
        if not first.startswith(b'%PDF-'):
            raise HTTPException(415, 'The file is not a valid PDF')

        async def read_chunks():
            total = 0
            digest = hashlib.sha256() if etag else None
            last = b''
            chunk = first
            try:
                while chunk:
                    total += len(chunk)
                    if total > MAX_PREVIEW_BYTES or (digest and total > size):
                        raise RuntimeError('Drive returned more PDF bytes than expected')
                    if digest:
                        digest.update(chunk)
                    if digest and total == size:
                        # A Drive update can race the media request. Hold the last
                        # chunk so a mismatched stream never completes under this ETag.
                        last = chunk
                    else:
                        yield chunk
                    chunk = await anext(chunks, b'')
                if digest:
                    if total != size or not hmac.compare_digest(digest.hexdigest(), checksum):
                        raise RuntimeError('Drive PDF changed during download')
                    yield last
            finally:
                try:
                    await upstream.aclose()
                finally:
                    await client.aclose()

        streaming = True
        return StreamingResponse(read_chunks(), media_type='application/pdf', headers=response_headers)
    finally:
        if not streaming:
            try:
                if upstream is not None:
                    await upstream.aclose()
            finally:
                await client.aclose()


@router.delete('/disconnect')
async def disconnect(user: User = Depends(current_user)):
    _store().delete(user.uid, 'secrets', 'drive-token')
    await asyncio.to_thread(_store().sync_index, user.uid, {})
    _store().delete(user.uid, 'drive-settings', 'source-folder')
    return {'ok': True, 'note': 'Local token removed; revoke app access in your Google Account if desired'}

# v0.3: explicitly selected Goodnotes backup, bounded recursive discovery and
# human-confirmed course/week suggestions. These calls do not copy PDF contents.
from collections import deque
from pydantic import BaseModel, Field

from .matching import suggest

FOLDER_MIME = 'application/vnd.google-apps.folder'
PDF_MIME = 'application/pdf'
MAX_SCAN_FILES = 500
MAX_SCAN_FOLDERS = 200


class SourceFolder(BaseModel):
    folder_id: str = Field(pattern=r'^[A-Za-z0-9_-]{5,200}$')


def _selected_folder(store, uid):
    return store.get(uid, 'drive-settings', 'source-folder')


def _index_results(store, uid, indexed=None):
    from .main import all_docs
    courses = [c for c in all_docs(uid, 'courses') if not c.get('archived', False)]
    weeks = all_docs(uid, 'weeks')
    resources = all_docs(uid, 'resources')
    linked = {}
    for entry in resources:
        if entry.get('source') == 'drive' and entry.get('drive_file_id'):
            linked.setdefault(entry['drive_file_id'], []).append({
                'resource_id': entry['id'], 'course_id': entry['course_id'],
                'week_number': entry['week_number']
            })
    result = []
    for item in (indexed if indexed is not None else store.list(uid, 'drive-index')):
        result.append({**item, 'suggestion': suggest(item['path'], item['name'], courses, weeks),
                       'links': linked.get(item['id'], [])})
    return sorted(result, key=lambda f: (f['path'].casefold(), f['name'].casefold()))


@router.get('/source-folder')
async def source_folder(user: User = Depends(current_user)):
    return {'folder': _selected_folder(_store(), user.uid)}


@router.post('/source-folder')
async def choose_source_folder(value: SourceFolder, user: User = Depends(current_user)):
    store = _store()
    token = await access_token(store, user.uid)
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.get(
            f'{DRIVE_FILES}/{value.folder_id}',
            params={'fields': 'id,name,mimeType,trashed'},
            headers={'Authorization': f'Bearer {token}'})
    if response.status_code != 200:
        raise HTTPException(404, 'Cannot access the selected Drive folder')
    info = response.json()
    if info.get('mimeType') != FOLDER_MIME or info.get('trashed'):
        raise HTTPException(422, 'Choose an existing Google Drive folder')
    old = _selected_folder(store, user.uid)
    if not old or old['folder_id'] != value.folder_id:
        await asyncio.to_thread(store.sync_index, user.uid, {})
    setting = {'id': 'source-folder', 'folder_id': value.folder_id,
               'name': info.get('name') or 'Goodnotes backup',
               'scanned_at': old.get('scanned_at') if old and old['folder_id'] == value.folder_id else None}
    store.put(user.uid, 'drive-settings', setting)
    return {'folder': setting}


async def _children(client, access: str, folder_id: str):
    """Retrieve all pages for one folder, failing closed on a Google API error."""
    found = []
    token = None
    pages = 0
    while True:
        pages += 1
        if pages > 50:  # protect against unexpected pagination loops
            raise HTTPException(413, 'Too many pages inside a Drive folder')
        params = {
            'q': f"'{folder_id}' in parents and trashed = false and (mimeType = '{PDF_MIME}' or mimeType = '{FOLDER_MIME}')",
            'fields': 'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink)',
            'pageSize': 100,
        }
        if token:
            params['pageToken'] = token
        res = await client.get(DRIVE_FILES, params=params, headers={'Authorization': f'Bearer {access}'})
        if res.status_code != 200:
            raise HTTPException(502, f'Could not scan Google Drive folder ({res.status_code})')
        payload = res.json()
        found.extend(payload.get('files', []))
        next_token = payload.get('nextPageToken')
        if not next_token:
            break
        if next_token == token:
            raise HTTPException(502, 'Google Drive returned a repeated page token')
        token = next_token
    return found


@router.post('/scan')
async def scan_backup(user: User = Depends(current_user)):
    store = _store()
    folder = _selected_folder(store, user.uid)
    if not folder:
        raise HTTPException(409, 'Choose your Goodnotes backup folder first')
    access = await access_token(store, user.uid)
    pending = deque([(folder['folder_id'], folder['name'])])
    visited = set()
    found = {}
    async with httpx.AsyncClient(timeout=35) as client:
        while pending:
            folder_id, path = pending.popleft()
            if folder_id in visited:
                continue
            visited.add(folder_id)
            if len(visited) > MAX_SCAN_FOLDERS:
                raise HTTPException(413, f'Backup contains more than {MAX_SCAN_FOLDERS} folders; choose a smaller folder')
            children = await _children(client, access, folder_id)
            for file in children:
                file_id = file.get('id', '')
                if not DRIVE_ID.fullmatch(file_id):
                    continue
                if file.get('mimeType') == FOLDER_MIME:
                    pending.append((file_id, f"{path}/{file['name']}"))
                elif file.get('mimeType') == PDF_MIME:
                    found[file_id] = {
                        'id': file_id, 'name': file['name'], 'path': path,
                        'modifiedTime': file.get('modifiedTime'), 'size': file.get('size'),
                        'webViewLink': file.get('webViewLink')
                    }
                    if len(found) > MAX_SCAN_FILES:
                        raise HTTPException(413, f'Backup contains more than {MAX_SCAN_FILES} PDFs; choose a smaller folder')
    # Persist metadata only after the entire scan succeeds, so failed scans
    # don't remove a previous good index.
    changes = await asyncio.to_thread(store.sync_index, user.uid, found)
    folder['scanned_at'] = int(time.time())
    await asyncio.to_thread(store.put, user.uid, 'drive-settings', folder)
    return {'scanned_at': folder['scanned_at'], 'count': len(found), 'changes': changes,
            'files': await asyncio.to_thread(_index_results, store, user.uid, list(found.values()))}


@router.get('/index')
async def indexed_backup(user: User = Depends(current_user)):
    store = _store()

    def load_index():
        folder = _selected_folder(store, user.uid)
        return {'folder': folder, 'files': _index_results(store, user.uid) if folder else []}

    return await asyncio.to_thread(load_index)
