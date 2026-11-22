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


def validate(model, values):
    try:
        return model.model_validate(values)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from None


@router.post('/semesters', response_model=Semester, status_code=201)
async def create_semester(value: Semester, user: User = Depends(current_user)):
    if any(s['name'].casefold() == value.name.casefold() for s in store().list(user.uid, 'semesters')):
        raise HTTPException(409, 'Semester already exists')
    store().put(user.uid, 'semesters', value.model_dump(mode='json'))
    return value


@router.patch('/semesters/{identifier}', response_model=Semester)
async def edit_semester(identifier: str, patch: SemesterPatch, user: User = Depends(current_user)):
    old = require(user.uid, 'semesters', identifier)
    value = validate(Semester, {**old, **patch.model_dump(mode='json', exclude_unset=True)})
    for other in store().list(user.uid, 'semesters'):
        if other['id'] != identifier and other['name'].casefold() == value.name.casefold():
            raise HTTPException(409, 'Semester already exists')
    store().put(user.uid, 'semesters', value.model_dump(mode='json'))
    # Keep legacy semester label in sync for existing linked course documents.
    for course in store().list(user.uid, 'courses'):
        if course.get('semester_id') == identifier:
            course['semester'] = value.name
            store().put(user.uid, 'courses', course)
    return value


@router.delete('/semesters/{identifier}', status_code=204)
async def remove_semester(identifier: str, user: User = Depends(current_user)):
    record = require(user.uid, 'semesters', identifier)
    if any(c.get('semester_id') == identifier or (not c.get('semester_id') and c.get('semester') == record['name']) for c in store().list(user.uid, 'courses')):
        raise HTTPException(409, 'Move or delete courses before removing this semester')
    store().delete(user.uid, 'semesters', identifier)


@router.patch('/courses/{identifier}', response_model=Course)
async def edit_course(identifier: str, patch: CoursePatch, user: User = Depends(current_user)):
    original = require(user.uid, 'courses', identifier)
    fields = patch.model_dump(mode='json', exclude_unset=True)
    if fields.get('semester_id'):
        semester = require(user.uid, 'semesters', fields['semester_id'])
        fields['semester'] = semester['name']
    elif 'semester' in fields and original.get('semester_id') and original.get('semester') != fields['semester']:
        fields['semester_id'] = None  # prevent contradictory names and IDs
    value = validate(Course, {**original, **fields})
    if value.semester_id:
        semester = require(user.uid, 'semesters', value.semester_id)
        value.semester = semester['name']
    for kind, field in [('weeks', 'number'), ('items', 'week_number'), ('resources', 'week_number')]:
        if any(row.get('course_id') == identifier and (row.get(field) or 0) > value.week_count for row in store().list(user.uid, kind)):
            raise HTTPException(409, 'Cannot shorten course while later weeks contain data')
    store().put(user.uid, 'courses', value.model_dump(mode='json'))
    return value


@router.delete('/courses/{identifier}', status_code=204)
async def remove_course(identifier: str, user: User = Depends(current_user)):
    require(user.uid, 'courses', identifier)
    for kind in ('weeks', 'items', 'resources', 'sessions'):
        if any(row.get('course_id') == identifier for row in store().list(user.uid, kind)):
            raise HTTPException(409, f'Course has linked {kind}; delete or move them first')
    store().delete(user.uid, 'courses', identifier)


@router.patch('/weeks/{identifier}', response_model=Week)
async def edit_week(identifier: str, patch: WeekPatch, user: User = Depends(current_user)):
    old = require(user.uid, 'weeks', identifier)
    value = validate(Week, {**old, **patch.model_dump(mode='json', exclude_unset=True)})
    store().put(user.uid, 'weeks', value.model_dump(mode='json'))
    return value


@router.patch('/resources/{identifier}', response_model=Resource)
async def edit_resource(identifier: str, patch: ResourcePatch, user: User = Depends(current_user)):
    old = require(user.uid, 'resources', identifier)
    merged = {**old, **patch.model_dump(mode='json', exclude_unset=True)}
    if merged.get('item_id'):
        item = require(user.uid, 'items', merged['item_id'])
        if item.get('course_id') != old['course_id'] or item.get('week_number') != old['week_number']:
            raise HTTPException(422, 'Linked item is not in the same course/week')
    value = validate(Resource, merged)
    store().put(user.uid, 'resources', value.model_dump(mode='json'))
    return value
