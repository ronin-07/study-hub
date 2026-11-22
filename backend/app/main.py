"""Study Hub API: private coursework resources, unified tasks, and durable focus sessions."""
from __future__ import annotations

import os
import time
import asyncio
from datetime import date
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import ValidationError

from .workspace_models import Semester
from .models import Course, FocusSession, FinishFocus, Item, ItemPatch, PauseFocus, ReadingPosition, Resource, StartFocus, Week
from .security import User, current_user, firebase_app
from .deployment import validate_deployment_environment
from .storage import (ActiveSessionExists, DocumentAlreadyExists, DocumentMissing,
                      SessionStateConflict, get_store)

validate_deployment_environment()

if os.getenv('STUDY_HUB_AUTH_MODE', 'local') == 'firebase' or os.getenv('STORAGE_BACKEND') == 'firestore':
    firebase_app()

app_store = get_store()
app = FastAPI(title='Study Hub API', version='0.5.0')

@app.middleware('http')
async def api_server_timing(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Server-Timing'] = f'api;dur={(time.perf_counter()-started)*1000:.1f}'
        response.headers['Cache-Control'] = 'private, no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
    return response
if os.getenv('STUDY_HUB_AUTH_MODE', 'local') == 'local':
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])
app.add_middleware(CORSMiddleware,
                   allow_origins=[v.strip() for v in os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(',') if v.strip()],
                   allow_credentials=False, allow_methods=['GET', 'POST', 'PATCH', 'DELETE'],
                   allow_headers=['Authorization', 'Content-Type'])

from .drive import router as drive_router  # noqa: E402
app.include_router(drive_router)
from .workspace import router as workspace_router, ensure_course_active, validate_item_reference, normalized_code  # noqa: E402
app.include_router(workspace_router)


def all_docs(uid: str, kind: str) -> list[dict]:
    return app_store.list(uid, kind)



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
    kinds = ('courses', 'weeks', 'items', 'resources', 'sessions', 'semesters')
    # Firestore's blocking stream() calls would otherwise run six times in series.
    # SQLite remains sequential to avoid unnecessary threads/local lock contention.
    if os.getenv('STORAGE_BACKEND') == 'firestore':
        rows = await asyncio.gather(*(asyncio.to_thread(all_docs, user.uid, kind) for kind in kinds))
    else:
        rows = [all_docs(user.uid, kind) for kind in kinds]
    return dict(zip(kinds, rows))


@app.get('/api/items', response_model=list[Item])
def list_items(user: User = Depends(current_user)):
    return all_docs(user.uid, 'items')


@app.post('/api/courses', response_model=Course, status_code=201)
def add_course(value: Course, user: User = Depends(current_user)):
    if not value.semester_id:
        raise HTTPException(422, 'A registered semester_id is required')
    value.code = value.code.strip()
    if not value.code:
        raise HTTPException(422, 'Course code cannot be blank')

    def operation(tx):
        semester = tx.get('semesters', value.semester_id)
        if not semester:
            raise HTTPException(422, 'Semester does not exist')
        value.semester = semester['name']
        if any(c.get('semester_id') == value.semester_id
               and normalized_code(c.get('code', '')) == normalized_code(value.code)
               for c in tx.list('courses')):
            raise HTTPException(409, 'Course code already exists in this semester')
        tx.create('courses', value.model_dump(mode='json'))
        return value

    try:
        return app_store.workspace_atomic(user.uid, operation)
    except DocumentAlreadyExists:
        raise HTTPException(409, 'Course ID already exists') from None


@app.post('/api/weeks', response_model=Week, status_code=201)
def add_week(value: Week, user: User = Depends(current_user)):
    def operation(tx):
        course = tx.get('courses', value.course_id)
        if not course:
            raise HTTPException(404, 'courses not found')
        if course.get('archived', False):
            raise HTTPException(409, 'Course is archived; restore it before making changes')
        if value.number > course['week_count']:
            raise HTTPException(422, 'Week exceeds course length')
        if any(w.get('course_id') == value.course_id and w['number'] == value.number
               for w in tx.list('weeks')):
            raise HTTPException(409, 'This course week already exists')
        tx.create('weeks', value.model_dump(mode='json'))
        return value

    try:
        return app_store.workspace_atomic(user.uid, operation)
    except DocumentAlreadyExists:
        raise HTTPException(409, 'Week ID already exists') from None


@app.post('/api/items', response_model=Item, status_code=201)
def add_item(value: Item, user: User = Depends(current_user)):
    if value.planned_date and value.due_date and value.planned_date > value.due_date:
        raise HTTPException(422, 'Planned work date cannot be after the deadline')

    def operation(tx):
        if value.week_number is not None and not value.course_id:
            raise HTTPException(422, 'Week requires course')
        if value.course_id:
            course = tx.get('courses', value.course_id)
            if not course:
                raise HTTPException(404, 'courses not found')
            if course.get('archived', False):
                raise HTTPException(409, 'Course is archived; restore it before making changes')
            if value.week_number is not None and value.week_number > course['week_count']:
                raise HTTPException(422, 'Week exceeds course length')
        if value.resource_id:
            resource = tx.get('resources', value.resource_id)
            if not resource:
                raise HTTPException(404, 'resources not found')
            if not value.course_id or resource['course_id'] != value.course_id:
                raise HTTPException(422, 'Referenced resource belongs to another course')
            if resource.get('week_number') is not None and resource['week_number'] != value.week_number:
                raise HTTPException(422, 'Referenced weekly resource belongs to another week')
        tx.create('items', value.model_dump(mode='json'))
        return value

    try:
        return app_store.workspace_atomic(user.uid, operation)
    except DocumentAlreadyExists:
        raise HTTPException(409, 'Item ID already exists') from None


@app.patch('/api/items/{identifier}', response_model=Item)
def patch_item(identifier: str, updates: ItemPatch, user: User = Depends(current_user)):
    fields = updates.model_dump(exclude_unset=True, mode='json')

    def update(original: dict) -> tuple[dict, dict | None]:
        if original.get('course_id'):
            ensure_course_active(user.uid, original['course_id'])
        merged = {**original, **fields}
        # Enforce on date changes but keep legacy records completable/editable.
        if ('planned_date' in fields or 'due_date' in fields) and merged.get('planned_date') and merged.get('due_date') and merged['planned_date'] > merged['due_date']:
            raise HTTPException(422, 'Planned work date cannot be after the deadline')
        validate_item_reference(user.uid, merged.get('course_id'), merged.get('week_number'), merged.get('resource_id'))
        try:
            value = Item.model_validate(merged)
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from None
        successor = None
        if not original.get('done', False) and value.done and value.repeat != 'none':
            from .recurrence import next_occurrence
            successor = next_occurrence(value).model_dump(mode='json')
        return value.model_dump(mode='json'), successor

    try:
        result = app_store.update_item_atomic(user.uid, identifier, update)
    except DocumentMissing:
        raise HTTPException(404, 'Item not found') from None
    return Item.model_validate(result)

@app.delete('/api/items/{identifier}', status_code=204)
def delete_item(identifier: str, user: User = Depends(current_user)):
    def operation(tx):
        item = tx.get('items', identifier)
        if not item:
            raise HTTPException(404, 'Item not found')
        if item.get('course_id'):
            course = tx.get('courses', item['course_id'])
            if not course:
                raise HTTPException(404, 'courses not found')
            if course.get('archived', False):
                raise HTTPException(409, 'Course is archived; restore it before making changes')
        if any(r.get('item_id') == identifier for r in tx.list('resources')):
            raise HTTPException(409, 'Detach linked PDF resources before deleting this study item')
        tx.delete('items', identifier)

    app_store.workspace_atomic(user.uid, operation)


@app.post('/api/resources', response_model=Resource, status_code=201)
def add_resource(value: Resource, user: User = Depends(current_user)):
    def operation(tx):
        course = tx.get('courses', value.course_id)
        if not course:
            raise HTTPException(404, 'courses not found')
        if course.get('archived', False):
            raise HTTPException(409, 'Course is archived; restore it before making changes')
        if value.week_number is not None and value.week_number > course['week_count']:
            raise HTTPException(422, 'Week exceeds course length')
        if value.item_id:
            item = tx.get('items', value.item_id)
            if not item:
                raise HTTPException(404, 'Linked study item not found')
            if item.get('course_id') != value.course_id or item.get('week_number') != value.week_number:
                raise HTTPException(422, 'Linked study item belongs to a different course/week')
        if value.source == 'drive':
            if any(existing.get('source') == 'drive'
                   and existing.get('drive_file_id') == value.drive_file_id
                   and existing.get('course_id') == value.course_id
                   and (existing.get('week_number') == value.week_number
                        or existing.get('week_number') is None or value.week_number is None)
                   for existing in tx.list('resources')):
                raise HTTPException(409, 'This PDF is already linked to that course and week')
        tx.create('resources', value.model_dump(mode='json'))
        return value

    try:
        return app_store.workspace_atomic(user.uid, operation)
    except DocumentAlreadyExists:
        raise HTTPException(409, 'Resource ID already exists') from None


@app.patch('/api/resources/{identifier}/reading-position', response_model=Resource)
def update_reading_position(identifier: str, value: ReadingPosition, user: User = Depends(current_user)):
    def operation(tx):
        entry = tx.get('resources', identifier)
        if not entry:
            raise HTTPException(404, 'Resource not found')
        # Bookmarks remain editable for archived courses. Merge with the latest
        # persisted resource so a concurrent title/edit is not overwritten.
        entry['last_page'] = value.page
        tx.put('resources', entry)
        return Resource.model_validate(entry)

    return app_store.workspace_atomic(user.uid, operation)


@app.delete('/api/resources/{identifier}', status_code=204)
def delete_resource(identifier: str, user: User = Depends(current_user)):
    def operation(tx):
        entry = tx.get('resources', identifier)
        if not entry:
            raise HTTPException(404, 'Resource not found')
        course = tx.get('courses', entry['course_id'])
        if not course:
            raise HTTPException(404, 'courses not found')
        if course.get('archived', False):
            raise HTTPException(409, 'Course is archived; restore it before making changes')
        if any(i.get('resource_id') == identifier for i in tx.list('items')):
            raise HTTPException(409, 'Unlink this resource from study items before removing it')
        tx.delete('resources', identifier)

    app_store.workspace_atomic(user.uid, operation)


def now_s():
    return int(time.time())


def focus_seconds(session: dict, now: int):
    paused = session.get('accumulated_pause_seconds', 0)
    if session['status'] == 'paused' and session.get('pause_started_at'):
        paused += max(0, now - session['pause_started_at'])
    return max(0, now - session['started_at'] - paused)


@app.post('/api/sessions/start', response_model=FocusSession, status_code=201)
def start_session(value: StartFocus, user: User = Depends(current_user)):
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
    timestamp = now_s()
    # Accept up to five seconds of network latency, but never trust an arbitrary
    # client-supplied start time. Old callers that omit requested_at are unchanged.
    started_at = max(timestamp - 5, min(timestamp, value.requested_at)) if value.requested_at is not None else timestamp
    session = FocusSession(**value.model_dump(exclude={'requested_at'}), started_at=started_at)
    try:
        app_store.start_focus_atomic(user.uid, session.model_dump(mode='json'))
    except ActiveSessionExists:
        raise HTTPException(409, 'A focus session is already active; resume or finish it first') from None
    except SessionStateConflict:
        raise HTTPException(409, 'Course is no longer available for Focus; refresh and retry') from None
    return session


def update_focus_or_error(uid: str, identifier: str, mutate):
    try:
        return app_store.update_focus_atomic(uid, identifier, mutate)
    except DocumentMissing:
        raise HTTPException(404, 'Session not found') from None
    except SessionStateConflict:
        raise HTTPException(409, 'Session state is inconsistent; refresh and retry') from None


@app.post('/api/sessions/{identifier}/pause', response_model=FocusSession)
def pause_session(identifier: str, value: PauseFocus | None = None, user: User = Depends(current_user)):
    timestamp = now_s()

    def pause(entry: dict) -> dict:
        if entry['status'] != 'running':
            raise HTTPException(409, 'Only a running session can be paused')
        # The user's stopwatch stops on click, not when the server response arrives.
        # A caller can only shorten focus time; inflating it is not allowed.
        if value is not None and value.displayed_seconds is not None:
            actual = focus_seconds(entry, timestamp)
            corrected = min(value.displayed_seconds, actual)
            entry['accumulated_pause_seconds'] += actual - corrected
        entry['status'] = 'paused'
        entry['pause_started_at'] = timestamp
        return entry

    return update_focus_or_error(user.uid, identifier, pause)


@app.post('/api/sessions/{identifier}/resume', response_model=FocusSession)
def resume_session(identifier: str, user: User = Depends(current_user)):
    timestamp = now_s()

    def resume(entry: dict) -> dict:
        if entry['status'] != 'paused':
            raise HTTPException(409, 'Only a paused session can be resumed')
        entry['accumulated_pause_seconds'] += max(0, timestamp - entry['pause_started_at'])
        entry['pause_started_at'] = None
        entry['status'] = 'running'
        return entry

    return update_focus_or_error(user.uid, identifier, resume)


@app.post('/api/sessions/{identifier}/finish', response_model=FocusSession)
def finish_session(identifier: str, value: FinishFocus, user: User = Depends(current_user)):
    timestamp = now_s()

    def finish(entry: dict) -> dict:
        if entry['status'] == 'finished':
            raise HTTPException(409, 'Session already finished')
        calculated = focus_seconds(entry, timestamp)
        if value.confirmed_seconds is not None and value.confirmed_seconds > calculated:
            raise HTTPException(422, 'Confirmed focus time cannot exceed unpaused time')
        entry['focus_seconds'] = calculated if value.confirmed_seconds is None else value.confirmed_seconds
        entry['ended_at'] = timestamp
        entry['status'] = 'finished'
        entry['pause_started_at'] = None
        return entry

    return update_focus_or_error(user.uid, identifier, finish)


@app.delete('/api/sessions/{identifier}', status_code=204)
def delete_session(identifier: str, user: User = Depends(current_user)):
    session = app_store.get(user.uid, 'sessions', identifier)
    if not session:
        raise HTTPException(404, 'Session not found')
    if session.get('course_id'):
        ensure_course_active(user.uid, session['course_id'])
    try:
        app_store.delete_focus_atomic(user.uid, identifier)
    except DocumentMissing:
        raise HTTPException(404, 'Session not found') from None
    except SessionStateConflict:
        raise HTTPException(409, 'Session state is inconsistent; refresh and retry') from None
