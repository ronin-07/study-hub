"""Course, semester and resource editing API; additive to v0.3 for existing data."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from .models import Course, Resource, Week
from .security import User, current_user
from .workspace_models import Semester, SemesterPatch, CoursePatch, WeekPatch, ResourcePatch

router = APIRouter(prefix='/api', tags=['workspace'])


def store():
    from .main import app_store
    return app_store


def require(uid, kind, identifier):
    doc = store().get(uid, kind, identifier)
    if not doc:
        raise HTTPException(404, f'{kind} not found')
    return doc


def ensure_course_active(uid: str, course_id: str):
    course = require(uid, 'courses', course_id)
    if course.get('archived', False):
        raise HTTPException(409, 'Course is archived; restore it before making changes')
    return course


def validate_item_reference(uid: str, course_id: str | None, week_number: int | None, resource_id: str | None):
    if not resource_id:
        return
    resource = require(uid, 'resources', resource_id)
    if not course_id or resource['course_id'] != course_id:
        raise HTTPException(422, 'Referenced resource belongs to another course')
    if resource.get('week_number') is not None and resource['week_number'] != week_number:
        raise HTTPException(422, 'Referenced weekly resource belongs to another week')


def validate(model, values):
    try:
        return model.model_validate(values)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from None


@router.post('/semesters', response_model=Semester, status_code=201)
async def create_semester(value: Semester, user: User = Depends(current_user)):
    value.name = value.name.strip()
    if not value.name:
        raise HTTPException(422, 'Semester name cannot be blank')
    if any(s['name'].casefold() == value.name.casefold() for s in store().list(user.uid, 'semesters')):
        raise HTTPException(409, 'Semester already exists')
    from .main import create_doc
    create_doc(user.uid, 'semesters', value.model_dump(mode='json'))
    return value


@router.patch('/semesters/{identifier}', response_model=Semester)
async def edit_semester(identifier: str, patch: SemesterPatch, user: User = Depends(current_user)):
    old = require(user.uid, 'semesters', identifier)
    value = validate(Semester, {**old, **patch.model_dump(mode='json', exclude_unset=True)})
    value.name = value.name.strip()
    if not value.name:
        raise HTTPException(422, 'Semester name cannot be blank')
    for other in store().list(user.uid, 'semesters'):
        if other['id'] != identifier and other['name'].casefold() == value.name.casefold():
            raise HTTPException(409, 'Semester already exists')
    store().put(user.uid, 'semesters', value.model_dump(mode='json'))
    # Keep legacy semester label in sync for existing linked course documents.
    for course in store().list(user.uid, 'courses'):
        if course.get('semester_id') == identifier:
            course['semester_id'] = identifier
            course['semester'] = value.name
            store().put(user.uid, 'courses', course)
    return value


@router.delete('/semesters/{identifier}', status_code=204)
async def remove_semester(identifier: str, user: User = Depends(current_user)):
    record = require(user.uid, 'semesters', identifier)
    if any(c.get('semester_id') == identifier for c in store().list(user.uid, 'courses')):
        raise HTTPException(409, 'Move or archive courses elsewhere before removing this semester')
    store().delete(user.uid, 'semesters', identifier)


@router.patch('/courses/{identifier}', response_model=Course)
async def edit_course(identifier: str, patch: CoursePatch, user: User = Depends(current_user)):
    original = ensure_course_active(user.uid, identifier)
    fields = patch.model_dump(mode='json', exclude_unset=True)
    # Names supplied by the browser are display hints only, not a way to
    # detach a course from its registered semester.
    fields.pop('semester', None)
    if 'semester_id' in fields and not fields['semester_id']:
        raise HTTPException(422, 'A registered semester_id is required')
    value = validate(Course, {**original, **fields})
    if not value.semester_id:
        raise HTTPException(422, 'A registered semester_id is required')
    semester = require(user.uid, 'semesters', value.semester_id)
    value.semester = semester['name']
    value.code = value.code.strip()
    if not value.code:
        raise HTTPException(422, 'Course code cannot be blank')
    from .main import verify_course_code_available
    verify_course_code_available(user.uid, value.semester_id, value.code, except_id=identifier)
    # Only scan linked collections when the week count is actually being shortened.
    # Ordinary title/semester edits should not trigger three unnecessary Firestore streams.
    if value.week_count < original['week_count']:
        for kind, field in [('weeks', 'number'), ('items', 'week_number'), ('resources', 'week_number')]:
            if any(row.get('course_id') == identifier and (row.get(field) or 0) > value.week_count for row in store().list(user.uid, kind)):
                raise HTTPException(409, 'Cannot shorten course while later weeks contain data')
    store().put(user.uid, 'courses', value.model_dump(mode='json'))
    return value


@router.post('/courses/{identifier}/archive', response_model=Course)
async def archive_course(identifier: str, user: User = Depends(current_user)):
    doc = require(user.uid, 'courses', identifier)
    if any(s.get('course_id') == identifier and s.get('status') in ('running', 'paused')
           for s in store().list(user.uid, 'sessions')):
        raise HTTPException(409, 'Finish or pause and finish the active focus session before archiving')
    doc['archived'] = True
    store().put(user.uid, 'courses', doc)
    return Course.model_validate(doc)


@router.post('/courses/{identifier}/restore', response_model=Course)
async def restore_course(identifier: str, user: User = Depends(current_user)):
    doc = require(user.uid, 'courses', identifier)
    doc['archived'] = False
    store().put(user.uid, 'courses', doc)
    return Course.model_validate(doc)


@router.delete('/courses/{identifier}')
async def remove_course(identifier: str, user: User = Depends(current_user)):
    require(user.uid, 'courses', identifier)
    raise HTTPException(405, 'Permanent deletion is disabled; archive the course instead')


@router.patch('/weeks/{identifier}', response_model=Week)
async def edit_week(identifier: str, patch: WeekPatch, user: User = Depends(current_user)):
    old = require(user.uid, 'weeks', identifier)
    ensure_course_active(user.uid, old['course_id'])
    value = validate(Week, {**old, **patch.model_dump(mode='json', exclude_unset=True)})
    store().put(user.uid, 'weeks', value.model_dump(mode='json'))
    return value


@router.patch('/resources/{identifier}', response_model=Resource)
async def edit_resource(identifier: str, patch: ResourcePatch, user: User = Depends(current_user)):
    old = require(user.uid, 'resources', identifier)
    ensure_course_active(user.uid, old['course_id'])
    merged = {**old, **patch.model_dump(mode='json', exclude_unset=True)}
    if merged.get('week_number') is not None:
        course = require(user.uid, 'courses', old['course_id'])
        if merged['week_number'] > course['week_count']:
            raise HTTPException(422, 'Resource week exceeds course length')
    if merged.get('item_id'):
        item = require(user.uid, 'items', merged['item_id'])
        if item.get('course_id') != old['course_id'] or item.get('week_number') != merged.get('week_number'):
            raise HTTPException(422, 'Linked item is not in the same course/week')
    if merged.get('source') == 'drive':
        for other in store().list(user.uid, 'resources'):
            if (other['id'] != identifier and other.get('course_id') == old['course_id']
                    and other.get('source') == 'drive' and other.get('drive_file_id') == merged.get('drive_file_id')
                    and (other.get('week_number') == merged.get('week_number')
                         or other.get('week_number') is None or merged.get('week_number') is None)):
                raise HTTPException(409, 'This Drive PDF is already linked in the course')
    for item in store().list(user.uid, 'items'):
        if item.get('resource_id') == identifier and merged.get('week_number') is not None:
            if item.get('week_number') != merged['week_number']:
                raise HTTPException(409, 'Other weeks reference this shared resource')
    value = validate(Resource, merged)
    store().put(user.uid, 'resources', value.model_dump(mode='json'))
    return value
