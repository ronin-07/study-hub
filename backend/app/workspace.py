"""Course, semester and resource editing API; additive to v0.3 for existing data."""
import hashlib
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
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
            courses = tx.list_equal('courses', 'semester_id', identifier)
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
                   for c in tx.list_equal('courses', 'semester_id', value.semester_id)):
                raise HTTPException(409, 'Course code already exists in this semester')
        if value.week_count < original['week_count']:
            for kind, field in [('weeks', 'number'), ('items', 'week_number'), ('resources', 'week_number')]:
                if any(row.get('course_id') == identifier and (row.get(field) or 0) > value.week_count
                       for row in tx.list_equal(kind, 'course_id', identifier)):
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
               for s in tx.list_equal('sessions', 'course_id', identifier)):
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


# Keep the old unconfirmed DELETE endpoint disabled. Permanent deletion uses
# a separate preview and confirmation contract, scoped to the signed-in user.
class CourseDeletionConfirmation(BaseModel):
    confirmation: str
    preview_token: str = Field(pattern=r'^[0-9a-f]{64}$')


def course_deletion_plan(tx, identifier: str):
    course = tx.get('courses', identifier)
    if not course:
        raise HTTPException(404, 'Course not found')
    if not course.get('archived', False):
        raise HTTPException(409, 'Archive the course before deleting it permanently')
    # A deletion is rare. Scan references once to catch even legacy cross-course
    # links and older Focus sessions omitted from the compact browser snapshot.
    all_items = tx.list('items')
    all_resources = tx.list('resources')
    items = [r for r in all_items if r.get('course_id') == identifier]
    resources = [r for r in all_resources if r.get('course_id') == identifier]
    weeks = tx.list_equal('weeks', 'course_id', identifier)
    item_ids = {r['id'] for r in items}
    resource_ids = {r['id'] for r in resources}
    sessions = [r for r in tx.list('sessions') if r.get('course_id') == identifier
                or r.get('item_id') in item_ids]
    # The same guard is read by archive and Focus start; never delete history.
    guard = tx.get('focus_guard', 'active')
    if guard:
        active = tx.get('sessions', guard['session_id'])
        if active and (active.get('course_id') == identifier or active.get('item_id') in item_ids):
            if not any(r['id'] == active['id'] for r in sessions):
                sessions.append(active)
    cross_links = sum(r.get('course_id') != identifier and r.get('resource_id') in resource_ids for r in all_items)
    cross_links += sum(r.get('course_id') != identifier and r.get('item_id') in item_ids for r in all_resources)
    cross_links += sum(r.get('course_id') != identifier and r.get('exam_paper_id') in resource_ids for r in all_resources)
    records = {'courses': [course], 'items': items, 'weeks': weeks, 'resources': resources}
    total = sum(map(len, records.values()))
    attempts = sum(len(r.get('exam_attempts') or []) for r in resources)
    blockers = []
    if sessions:
        blockers.append('This course has Focus history. Keep it archived to preserve your study statistics.')
    if cross_links:
        blockers.append('Other coursework references this course. Resolve those links before deleting.')
    # Leave room for the workspace guard write; never split a destructive operation.
    if total > 450:
        blockers.append('This course has too many records for one safe deletion. Keep it archived.')
    payload = json.dumps({k: sorted(v, key=lambda r: r['id']) for k, v in records.items()},
                         sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    if len(payload.encode('utf-8')) > 4 * 1024 * 1024:
        blockers.append('This course contains too much data for one safe deletion. Keep it archived.')
    return records, {'course_id': identifier, 'code': course['code'], 'title': course['title'],
                     'items': len(items), 'weeks': len(weeks), 'resources': len(resources),
                     'exam_attempts': attempts, 'focus_sessions': len(sessions),
                     'total_documents': total, 'blockers': blockers,
                     'preview_token': hashlib.sha256(payload.encode('utf-8')).hexdigest()}


@router.get('/courses/{identifier}/deletion-preview')
def preview_course_deletion(identifier: str, user: User = Depends(current_user)):
    return store().workspace_atomic(user.uid, lambda tx: course_deletion_plan(tx, identifier)[1])


@router.post('/courses/{identifier}/permanent-delete', status_code=204)
def permanently_delete_course(identifier: str, value: CourseDeletionConfirmation, user: User = Depends(current_user)):
    if value.confirmation != 'DELETE':
        raise HTTPException(422, 'Type DELETE to confirm permanent deletion')

    def operation(tx):
        records, preview = course_deletion_plan(tx, identifier)
        if preview['blockers']:
            raise HTTPException(409, ' '.join(preview['blockers']))
        if value.preview_token != preview['preview_token']:
            raise HTTPException(409, 'Course data changed. Reopen the deletion preview and review it again.')
        for kind, rows in records.items():
            for row in rows:
                tx.delete(kind, row['id'])

    store().workspace_atomic(user.uid, operation)


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


def validate_exam_pair(tx, resource, previous_paper_id=None):
    paper_id = resource.get('exam_paper_id')
    if not paper_id:
        return
    paper = tx.get('resources', paper_id)
    if not paper or paper.get('kind') != 'exam_paper' or paper.get('course_id') != resource.get('course_id'):
        raise HTTPException(422, 'Choose an existing question paper in the same course')
    if resource.get('kind') != 'exam_solution' or paper_id == resource.get('id'):
        raise HTTPException(422, 'Only a solution can be paired with a question paper')
    if paper_id != previous_paper_id and tx.list_equal('resources', 'exam_paper_id', paper_id):
        raise HTTPException(409, 'This question paper already has a solution')


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
        if old.get('exam_attempts') and merged.get('kind') != 'exam_paper':
            raise HTTPException(409, 'Remove recorded attempts before changing the paper type')
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
                   for other in tx.list_equal('resources', 'course_id', old['course_id'])):
                raise HTTPException(409, 'This Drive PDF is already linked in the course')
        if merged.get('week_number') is not None:
            if any(item.get('resource_id') == identifier and item.get('week_number') != merged['week_number']
                   for item in tx.list_equal('items', 'resource_id', identifier)):
                raise HTTPException(409, 'Other weeks reference this shared resource')
        if old.get('kind') == 'exam_paper' and merged.get('kind') != 'exam_paper' and tx.list_equal('resources', 'exam_paper_id', identifier):
            raise HTTPException(409, 'Unpair solutions before changing the question paper type')
        value = validate(Resource, merged)
        validate_exam_pair(tx, value.model_dump(mode='json'), old.get('exam_paper_id'))
        tx.put('resources', value.storage_document(old))
        return value

    return store().workspace_atomic(user.uid, operation)


class ExamDetailsPatch(BaseModel):
    display_name: str = Field(min_length=1, max_length=160)
    year: int | None = Field(default=None, ge=1900, le=2100)


class PairExistingSolution(BaseModel):
    solution_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')


@router.patch('/resources/{identifier}/exam-details', response_model=Resource)
def edit_exam_details(identifier: str, patch: ExamDetailsPatch, user: User = Depends(current_user)):
    name = patch.display_name.strip()
    if not name:
        raise HTTPException(422, 'Exam name cannot be blank')
    def operation(tx):
        paper = tx.get('resources', identifier)
        if not paper or paper.get('kind') != 'exam_paper':
            raise HTTPException(404, 'Question paper not found')
        course = tx.get('courses', paper['course_id'])
        if not course or course.get('archived', False):
            raise HTTPException(409, 'Course is unavailable or archived')
        result = validate(Resource, {**paper, 'exam_display_name': name, 'exam_year': patch.year})
        if paper.get('exam_display_name') != name or paper.get('exam_year') != patch.year:
            tx.put('resources', result.storage_document(paper))
        return result
    return store().workspace_atomic(user.uid, operation)


@router.post('/resources/{identifier}/pair-existing-solution', response_model=Resource)
def pair_existing_solution(identifier: str, value: PairExistingSolution, user: User = Depends(current_user)):
    def operation(tx):
        paper = tx.get('resources', identifier)
        solution = tx.get('resources', value.solution_id)
        if not paper or paper.get('kind') != 'exam_paper' or not solution or solution.get('kind') != 'exam_solution':
            raise HTTPException(404, 'Question paper or solution not found')
        if paper['course_id'] != solution['course_id']:
            raise HTTPException(422, 'Choose a solution in the same course')
        course = tx.get('courses', paper['course_id'])
        if not course or course.get('archived', False):
            raise HTTPException(409, 'Course is unavailable or archived')
        if solution.get('exam_paper_id') not in (None, identifier):
            raise HTTPException(409, 'This solution is already paired with another paper')
        result = validate(Resource, {**solution, 'exam_paper_id': identifier})
        if solution.get('exam_paper_id') != identifier:
            validate_exam_pair(tx, result.model_dump(mode='json'))
            tx.put('resources', result.storage_document(solution))
        return result
    return store().workspace_atomic(user.uid, operation)


@router.delete('/resources/{identifier}/paired-solutions/{solution_id}', response_model=Resource)
def unpair_existing_solution(identifier: str, solution_id: str, user: User = Depends(current_user)):
    def operation(tx):
        solution = tx.get('resources', solution_id)
        paper = tx.get('resources', identifier)
        if not solution or solution.get('kind') != 'exam_solution' or not paper or paper.get('kind') != 'exam_paper':
            raise HTTPException(404, 'Question paper or solution not found')
        if paper['course_id'] != solution['course_id']:
            raise HTTPException(422, 'Choose a solution in the same course')
        course = tx.get('courses', paper['course_id'])
        if not course or course.get('archived', False):
            raise HTTPException(409, 'Course is unavailable or archived')
        if solution.get('exam_paper_id') not in (None, identifier):
            raise HTTPException(409, 'This solution is now paired with a different paper')
        result = validate(Resource, {**solution, 'exam_paper_id': None})
        if solution.get('exam_paper_id') == identifier:
            tx.put('resources', result.storage_document(solution))
        return result
    return store().workspace_atomic(user.uid, operation)
