"""Course, semester and resource editing API; additive to v0.3 for existing data."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from .models import Course, Resource, Week
from .storage import DocumentAlreadyExists
from .security import User, current_user
from .workspace_models import Semester, SemesterPatch, CoursePatch, WeekPatch, ResourcePatch

router = APIRouter(prefix='/api', tags=['workspace'])


def normalized_code(code: str) -> str:
    return ' '.join(code.casefold().split())


def normalized_semester_name(name: str) -> str:
    return ' '.join(name.casefold().split())


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
def create_semester(value: Semester, user: User = Depends(current_user)):
    value.name = value.name.strip()
    if not value.name:
        raise HTTPException(422, 'Semester name cannot be blank')

    def operation(tx):
        if any(normalized_semester_name(s['name']) == normalized_semester_name(value.name) for s in tx.list('semesters')):
            raise HTTPException(409, 'Semester already exists')
        tx.create('semesters', value.model_dump(mode='json'))
        return value

    try:
        return store().workspace_atomic(user.uid, operation)
    except DocumentAlreadyExists:
        raise HTTPException(409, 'Semester ID already exists') from None


@router.patch('/semesters/{identifier}', response_model=Semester)
def edit_semester(identifier: str, patch: SemesterPatch, user: User = Depends(current_user)):
    fields = patch.model_dump(mode='json', exclude_unset=True)

    def operation(tx):
        old = tx.get('semesters', identifier)
        if not old:
            raise HTTPException(404, 'semesters not found')
        value = validate(Semester, {**old, **fields})
        value.name = value.name.strip()
        if not value.name:
            raise HTTPException(422, 'Semester name cannot be blank')
        if normalized_semester_name(value.name) != normalized_semester_name(old['name']) and any(
            s['id'] != identifier and normalized_semester_name(s['name']) == normalized_semester_name(value.name)
            for s in tx.list('semesters')
        ):
            raise HTTPException(409, 'Semester already exists')
        # Semester name is cached on courses for the existing UI. Commit all
        # related updates together, or none of them.
        if value.name != old['name']:
            courses = [c for c in tx.list('courses') if c.get('semester_id') == identifier]
            if len(courses) > 498:
                raise HTTPException(409, 'Too many courses to rename in one transaction')
            for course in courses:
                tx.put('courses', {**course, 'semester': value.name})
        tx.put('semesters', value.model_dump(mode='json'))
        return value

    return store().workspace_atomic(user.uid, operation)


@router.delete('/semesters/{identifier}', status_code=204)
def remove_semester(identifier: str, user: User = Depends(current_user)):
    def operation(tx):
        if not tx.get('semesters', identifier):
            raise HTTPException(404, 'semesters not found')
        if any(c.get('semester_id') == identifier for c in tx.list('courses')):
            raise HTTPException(409, 'Move courses elsewhere before removing this semester')
        tx.delete('semesters', identifier)

    store().workspace_atomic(user.uid, operation)


@router.patch('/courses/{identifier}', response_model=Course)
def edit_course(identifier: str, patch: CoursePatch, user: User = Depends(current_user)):
    fields = patch.model_dump(mode='json', exclude_unset=True)
    fields.pop('semester', None)  # Browser-provided labels are display hints only.
    if 'semester_id' in fields and not fields['semester_id']:
        raise HTTPException(422, 'A registered semester_id is required')

    def operation(tx):
        original = tx.get('courses', identifier)
        if not original:
            raise HTTPException(404, 'courses not found')
        if original.get('archived', False):
            raise HTTPException(409, 'Course is archived; restore it before making changes')
        value = validate(Course, {**original, **fields})
        if not value.semester_id:
            raise HTTPException(422, 'A registered semester_id is required')
        semester = tx.get('semesters', value.semester_id)
        if not semester:
            raise HTTPException(404, 'semesters not found')
        value.semester = semester['name']
        value.code = value.code.strip()
        if not value.code:
            raise HTTPException(422, 'Course code cannot be blank')
        if value.semester_id != original['semester_id'] or normalized_code(value.code) != normalized_code(original['code']):
            if any(c['id'] != identifier and c.get('semester_id') == value.semester_id
                   and normalized_code(c.get('code', '')) == normalized_code(value.code)
                   for c in tx.list('courses')):
                raise HTTPException(409, 'Course code already exists in this semester')
        if value.week_count < original['week_count']:
            for kind, field in [('weeks', 'number'), ('items', 'week_number'), ('resources', 'week_number')]:
                if any(row.get('course_id') == identifier and (row.get(field) or 0) > value.week_count
                       for row in tx.list(kind)):
                    raise HTTPException(409, 'Cannot shorten course while later weeks contain data')
        tx.put('courses', value.model_dump(mode='json'))
        return value

    return store().workspace_atomic(user.uid, operation)


@router.post('/courses/{identifier}/archive', response_model=Course)
def archive_course(identifier: str, user: User = Depends(current_user)):
    def operation(tx):
        doc = tx.get('courses', identifier)
        if not doc:
            raise HTTPException(404, 'courses not found')
        # Read the B1 active-session guard inside this transaction. A concurrent
        # Focus start writes the same guard, forcing one transaction to retry.
        guard = tx.get('focus_guard', 'active')
        if guard:
            current_session = tx.get('sessions', guard['session_id'])
            if current_session and current_session.get('course_id') == identifier and current_session.get('status') in ('running', 'paused'):
                raise HTTPException(409, 'Finish the active focus session before archiving')
        # Also reject legacy guardless sessions until Preview is reset.
        if any(s.get('course_id') == identifier and s.get('status') in ('running', 'paused')
               for s in tx.list('sessions')):
            raise HTTPException(409, 'Finish the active focus session before archiving')
        doc['archived'] = True
        tx.put('courses', doc)
        return Course.model_validate(doc)

    return store().workspace_atomic(user.uid, operation)


@router.post('/courses/{identifier}/restore', response_model=Course)
def restore_course(identifier: str, user: User = Depends(current_user)):
    def operation(tx):
        doc = tx.get('courses', identifier)
        if not doc:
            raise HTTPException(404, 'courses not found')
        doc['archived'] = False
        tx.put('courses', doc)
        return Course.model_validate(doc)

    return store().workspace_atomic(user.uid, operation)


@router.delete('/courses/{identifier}')
def remove_course(identifier: str, user: User = Depends(current_user)):
    require(user.uid, 'courses', identifier)
    raise HTTPException(405, 'Permanent deletion is disabled; archive the course instead')


@router.patch('/weeks/{identifier}', response_model=Week)
def edit_week(identifier: str, patch: WeekPatch, user: User = Depends(current_user)):
    fields = patch.model_dump(mode='json', exclude_unset=True)

    def operation(tx):
        old = tx.get('weeks', identifier)
        if not old:
            raise HTTPException(404, 'weeks not found')
        course = tx.get('courses', old['course_id'])
        if not course:
            raise HTTPException(404, 'courses not found')
        if course.get('archived', False):
            raise HTTPException(409, 'Course is archived; restore it before making changes')
        value = validate(Week, {**old, **fields})
        tx.put('weeks', value.model_dump(mode='json'))
        return value

    return store().workspace_atomic(user.uid, operation)


@router.patch('/resources/{identifier}', response_model=Resource)
def edit_resource(identifier: str, patch: ResourcePatch, user: User = Depends(current_user)):
    fields = patch.model_dump(mode='json', exclude_unset=True)

    def operation(tx):
        old = tx.get('resources', identifier)
        if not old:
            raise HTTPException(404, 'resources not found')
        course = tx.get('courses', old['course_id'])
        if not course:
            raise HTTPException(404, 'courses not found')
        if course.get('archived', False):
            raise HTTPException(409, 'Course is archived; restore it before making changes')
        merged = {**old, **fields}
        if merged.get('week_number') is not None and merged['week_number'] > course['week_count']:
            raise HTTPException(422, 'Resource week exceeds course length')
        if merged.get('item_id'):
            item = tx.get('items', merged['item_id'])
            if not item:
                raise HTTPException(404, 'items not found')
            if item.get('course_id') != old['course_id'] or item.get('week_number') != merged.get('week_number'):
                raise HTTPException(422, 'Linked item is not in the same course/week')
        if merged.get('source') == 'drive':
            if any(other['id'] != identifier and other.get('course_id') == old['course_id']
                   and other.get('source') == 'drive' and other.get('drive_file_id') == merged.get('drive_file_id')
                   and (other.get('week_number') == merged.get('week_number')
                        or other.get('week_number') is None or merged.get('week_number') is None)
                   for other in tx.list('resources')):
                raise HTTPException(409, 'This Drive PDF is already linked in the course')
        if merged.get('week_number') is not None:
            if any(item.get('resource_id') == identifier and item.get('week_number') != merged['week_number']
                   for item in tx.list('items')):
                raise HTTPException(409, 'Other weeks reference this shared resource')
        value = validate(Resource, merged)
        tx.put('resources', value.model_dump(mode='json'))
        return value

    return store().workspace_atomic(user.uid, operation)
