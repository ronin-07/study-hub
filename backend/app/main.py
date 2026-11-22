"""Study Hub API: private coursework resources, unified tasks, and durable focus sessions."""
from __future__ import annotations

import os
import time
from datetime import date
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import ValidationError

from .workspace_models import Semester
from .models import Course, FocusSession, FinishFocus, Item, ItemPatch, ReadingPosition, Resource, StartFocus, Week
from .security import User, current_user, firebase_app
from .deployment import validate_deployment_environment
from .storage import get_store

validate_deployment_environment()

if os.getenv('STUDY_HUB_AUTH_MODE', 'local') == 'firebase' or os.getenv('STORAGE_BACKEND') == 'firestore':
    firebase_app()

app_store = get_store()
app = FastAPI(title='Study Hub API', version='0.4.1')
if os.getenv('STUDY_HUB_AUTH_MODE', 'local') == 'local':
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])
app.add_middleware(CORSMiddleware,
                   allow_origins=[v.strip() for v in os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(',') if v.strip()],
                   allow_credentials=False, allow_methods=['GET', 'POST', 'PATCH', 'DELETE'],
                   allow_headers=['Authorization', 'Content-Type'])

from .drive import router as drive_router  # noqa: E402
app.include_router(drive_router)
from .workspace import router as workspace_router, ensure_course_active, validate_item_reference  # noqa: E402
app.include_router(workspace_router)


def all_docs(uid: str, kind: str) -> list[dict]:
    return app_store.list(uid, kind)


def exists(uid: str, kind: str, identifier: str):
    if not app_store.get(uid, kind, identifier):
        raise HTTPException(404, f'{kind} not found')


def validate_context(uid: str, course_id: str | None, week_number: int | None):
    if course_id:
        ensure_course_active(uid, course_id)
    if week_number is not None and not course_id:
        raise HTTPException(422, 'Week requires course')
    if course_id and week_number is not None:
        course = app_store.get(uid, 'courses', course_id)
        if week_number > course['week_count']:
            raise HTTPException(422, 'Week exceeds course length')


@app.get('/health')
async def health():
    return {'status': 'ok', 'storage': os.getenv('STORAGE_BACKEND', 'sqlite'), 'auth': os.getenv('STUDY_HUB_AUTH_MODE', 'local')}


@app.get('/api/snapshot')
async def snapshot(user: User = Depends(current_user)):
    return {kind: all_docs(user.uid, kind) for kind in ('courses', 'weeks', 'items', 'resources', 'sessions', 'semesters')}


@app.post('/api/courses', response_model=Course, status_code=201)
async def add_course(value: Course, user: User = Depends(current_user)):
    if value.semester_id:
        semester = app_store.get(user.uid, 'semesters', value.semester_id)
        if not semester:
            raise HTTPException(404, 'Semester not found')
        value.semester = semester['name']
    app_store.put(user.uid, 'courses', value.model_dump(mode='json'))
    return value


@app.post('/api/weeks', response_model=Week, status_code=201)
async def add_week(value: Week, user: User = Depends(current_user)):
    validate_context(user.uid, value.course_id, value.number)
    for week in all_docs(user.uid, 'weeks'):
        if week['course_id'] == value.course_id and week['number'] == value.number:
            raise HTTPException(409, 'This course week already exists')
    app_store.put(user.uid, 'weeks', value.model_dump(mode='json'))
    return value


@app.post('/api/items', response_model=Item, status_code=201)
async def add_item(value: Item, user: User = Depends(current_user)):
    validate_context(user.uid, value.course_id, value.week_number)
    validate_item_reference(user.uid, value.course_id, value.week_number, value.resource_id)
    app_store.put(user.uid, 'items', value.model_dump(mode='json'))
    return value


@app.patch('/api/items/{identifier}', response_model=Item)
async def patch_item(identifier: str, updates: ItemPatch, user: User = Depends(current_user)):
    original = app_store.get(user.uid, 'items', identifier)
    if not original:
        raise HTTPException(404, 'Item not found')
    if original.get('course_id'):
        ensure_course_active(user.uid, original['course_id'])
    merged = {**original, **updates.model_dump(exclude_unset=True, mode='json')}
    validate_item_reference(user.uid, merged.get('course_id'), merged.get('week_number'), merged.get('resource_id'))
    try:
        value = Item.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from None
    app_store.put(user.uid, 'items', value.model_dump(mode='json'))
    return value


@app.delete('/api/items/{identifier}', status_code=204)
async def delete_item(identifier: str, user: User = Depends(current_user)):
    item = app_store.get(user.uid, 'items', identifier)
    if not item: raise HTTPException(404, 'Item not found')
    if item.get('course_id'): ensure_course_active(user.uid, item['course_id'])
    if any(r.get('item_id') == identifier for r in all_docs(user.uid, 'resources')):
        raise HTTPException(409, 'Detach linked PDF resources before deleting this study item')
    app_store.delete(user.uid, 'items', identifier)


@app.post('/api/resources', response_model=Resource, status_code=201)
async def add_resource(value: Resource, user: User = Depends(current_user)):
    validate_context(user.uid, value.course_id, value.week_number)
    if value.item_id:
        linked_item = app_store.get(user.uid, 'items', value.item_id)
        if not linked_item:
            raise HTTPException(404, 'Linked study item not found')
        if linked_item.get('course_id') != value.course_id or linked_item.get('week_number') != value.week_number:
            raise HTTPException(422, 'Linked study item belongs to a different course/week')
    if value.source == 'drive':
        for existing in all_docs(user.uid, 'resources'):
            if (existing.get('source') == 'drive'
                    and existing.get('drive_file_id') == value.drive_file_id
                    and existing.get('course_id') == value.course_id
                    and (existing.get('week_number') == value.week_number
                         or existing.get('week_number') is None or value.week_number is None)):
                raise HTTPException(409, 'This PDF is already linked to that course and week')
    app_store.put(user.uid, 'resources', value.model_dump(mode='json'))
    return value


@app.patch('/api/resources/{identifier}/reading-position', response_model=Resource)
async def update_reading_position(identifier: str, value: ReadingPosition, user: User = Depends(current_user)):
    entry = app_store.get(user.uid, 'resources', identifier)
    if not entry:
        raise HTTPException(404, 'Resource not found')
    # Saving a reading bookmark is allowed on archived, read-only courses.
    entry['last_page'] = value.page
    app_store.put(user.uid, 'resources', entry)
    return Resource.model_validate(entry)


@app.delete('/api/resources/{identifier}', status_code=204)
async def delete_resource(identifier: str, user: User = Depends(current_user)):
    entry = app_store.get(user.uid, 'resources', identifier)
    if not entry: raise HTTPException(404, 'Resource not found')
    ensure_course_active(user.uid, entry['course_id'])
    if any(i.get('resource_id') == identifier for i in all_docs(user.uid, 'items')):
        raise HTTPException(409, 'Unlink this resource from study items before removing it')
    app_store.delete(user.uid, 'resources', identifier)


def now_s():
    return int(time.time())


def active_session(uid: str):
    for entry in all_docs(uid, 'sessions'):
        if entry['status'] in ('running', 'paused'):
            return entry
    return None


def session_or_404(uid: str, identifier: str):
    session = app_store.get(uid, 'sessions', identifier)
    if not session:
        raise HTTPException(404, 'Session not found')
    return session


def focus_seconds(session: dict, now: int):
    paused = session.get('accumulated_pause_seconds', 0)
    if session['status'] == 'paused' and session.get('pause_started_at'):
        paused += max(0, now - session['pause_started_at'])
    return max(0, now - session['started_at'] - paused)


@app.post('/api/sessions/start', response_model=FocusSession, status_code=201)
async def start_session(value: StartFocus, user: User = Depends(current_user)):
    if active_session(user.uid):
        raise HTTPException(409, 'A focus session is already active; resume or finish it first')
    validate_context(user.uid, value.course_id, value.week_number)
    if value.item_id:
        item = app_store.get(user.uid, 'items', value.item_id)
        if not item:
            raise HTTPException(404, 'Linked task not found')
        if item.get('course_id'): ensure_course_active(user.uid, item['course_id'])
        if value.course_id and item.get('course_id') != value.course_id:
            raise HTTPException(422, 'Task does not belong to selected course')
        if value.week_number and item.get('week_number') != value.week_number:
            raise HTTPException(422, 'Task does not belong to selected week')
        if not value.course_id and item.get('course_id'):
            value.course_id = item['course_id']
        if value.week_number is None and item.get('week_number'):
            value.week_number = item['week_number']
    if value.course_id: ensure_course_active(user.uid, value.course_id)
    session = FocusSession(**value.model_dump(), started_at=now_s())
    app_store.put(user.uid, 'sessions', session.model_dump(mode='json'))
    return session


@app.post('/api/sessions/{identifier}/pause', response_model=FocusSession)
async def pause_session(identifier: str, user: User = Depends(current_user)):
    entry = session_or_404(user.uid, identifier)
    if entry['status'] != 'running':
        raise HTTPException(409, 'Only a running session can be paused')
    entry['status'] = 'paused'
    entry['pause_started_at'] = now_s()
    app_store.put(user.uid, 'sessions', entry)
    return entry


@app.post('/api/sessions/{identifier}/resume', response_model=FocusSession)
async def resume_session(identifier: str, user: User = Depends(current_user)):
    entry = session_or_404(user.uid, identifier)
    if entry['status'] != 'paused':
        raise HTTPException(409, 'Only a paused session can be resumed')
    entry['accumulated_pause_seconds'] += max(0, now_s() - entry['pause_started_at'])
    entry['pause_started_at'] = None
    entry['status'] = 'running'
    app_store.put(user.uid, 'sessions', entry)
    return entry


@app.post('/api/sessions/{identifier}/finish', response_model=FocusSession)
async def finish_session(identifier: str, value: FinishFocus, user: User = Depends(current_user)):
    entry = session_or_404(user.uid, identifier)
    if entry['status'] == 'finished':
        raise HTTPException(409, 'Session already finished')
    timestamp = now_s()
    calculated = focus_seconds(entry, timestamp)
    if value.confirmed_seconds is not None:
        # Manual correction must never exceed total elapsed wall time.
        if value.confirmed_seconds > timestamp - entry['started_at']:
            raise HTTPException(422, 'Confirmed focus time cannot exceed elapsed time')
    entry['focus_seconds'] = calculated if value.confirmed_seconds is None else value.confirmed_seconds
    entry['ended_at'] = timestamp
    entry['status'] = 'finished'
    entry['pause_started_at'] = None
    app_store.put(user.uid, 'sessions', entry)
    return entry


@app.delete('/api/sessions/{identifier}', status_code=204)
async def delete_session(identifier: str, user: User = Depends(current_user)):
    session = session_or_404(user.uid, identifier)
    if session.get('course_id'):
        ensure_course_active(user.uid, session['course_id'])
    app_store.delete(user.uid, 'sessions', identifier)
