from __future__ import annotations

from datetime import date, time
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


def new_id() -> str:
    return uuid4().hex


class BaseDocument(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(default_factory=new_id, pattern=r'^[a-zA-Z0-9_-]{1,80}$')


class Course(BaseDocument):
    code: str = Field(min_length=2, max_length=40)
    title: str = Field(min_length=1, max_length=180)
    semester: str = Field(default='Autumn 2026', max_length=60)
    week_count: int = Field(default=13, ge=1, le=30)
    semester_id: str | None = None
    exam_date: date | None = None
    exam_time: time | None = None
    exam_duration_minutes: int | None = Field(default=None, ge=1, le=720)
    exam_location: str = Field(default="", max_length=240)
    exam_format: str = Field(default="", max_length=80)
    goals: str = Field(default='', max_length=2000)
    archived: bool = False


class Week(BaseDocument):
    course_id: str
    number: int = Field(ge=1, le=30)
    title: str = Field(min_length=1, max_length=180)
    objectives: str = Field(default='', max_length=3000)


ItemKind = Literal['lecture', 'notes', 'reading', 'questions', 'revision', 'assignment', 'exercise', 'personal']


class Item(BaseDocument):
    title: str = Field(min_length=1, max_length=240)
    kind: ItemKind = 'personal'
    course_id: str | None = None
    week_number: int | None = Field(default=None, ge=1, le=30)
    is_task: bool = False
    hidden_from_tasks: bool = False  # Explicit opt-out; preserves week activity and its references.
    done: bool = False
    submitted: bool = False
    planned_date: date | None = None
    due_date: date | None = None
    priority: Literal['low', 'medium', 'high'] = 'medium'
    repeat: Literal['none', 'daily', 'weekly', 'monthly'] = 'none'
    repeat_series_id: str | None = Field(default=None, max_length=80)
    notes: str = Field(default='', max_length=5000)
    chapter: str = Field(default='', max_length=120)
    page_start: int | None = Field(default=None, ge=1, le=20000)
    page_end: int | None = Field(default=None, ge=1, le=20000)
    resource_id: str | None = None  # Reference to a shared book/notebook or weekly PDF.

    @model_validator(mode='after')
    def coherent(self):
        if self.page_start is not None and self.page_end is not None and self.page_end < self.page_start:
            raise ValueError('End page cannot precede start page')
        if self.kind == 'assignment' or self.planned_date is not None or self.due_date is not None:
            # Planning a study item makes it actionable in the single Tasks view.
            self.is_task = True
        if self.kind == 'personal':
            self.course_id = None
            self.week_number = None
            self.is_task = True
        if self.hidden_from_tasks and (not self.course_id or self.week_number is None):
            raise ValueError('Only course-week activities can be removed from Tasks without deletion')
        if self.week_number is not None and self.course_id is None:
            raise ValueError('A week must belong to a course')
        if self.repeat != 'none':
            if self.planned_date is None:
                raise ValueError('Repeating tasks require a planned date')
            if self.kind == 'assignment':
                raise ValueError('Use individual deadlines for assignments rather than repetition')
        if self.submitted and self.kind != 'assignment':
            raise ValueError('Only an assignment may be marked submitted')
        return self


class ActivityDefinition(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=240)
    kind: Literal['lecture', 'notes', 'reading', 'questions', 'revision', 'assignment', 'exercise']


class GenerateActivities(BaseModel):
    model_config = ConfigDict(extra='forbid')
    activities: list[ActivityDefinition] = Field(min_length=1, max_length=10)
    weeks: list[int] = Field(min_length=1, max_length=30)


class GenerationResult(BaseModel):
    created: int
    skipped: int
    items: list[Item]


class ItemUpdateResult(BaseModel):
    item: Item
    successor: Item | None = None


class ItemPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str | None = Field(default=None, min_length=1, max_length=240)
    done: bool | None = None
    submitted: bool | None = None
    is_task: bool | None = None
    hidden_from_tasks: bool | None = None
    kind: ItemKind | None = None
    planned_date: date | None = None
    due_date: date | None = None
    priority: Literal['low', 'medium', 'high'] | None = None
    repeat: Literal['none', 'daily', 'weekly', 'monthly'] | None = None
    notes: str | None = Field(default=None, max_length=5000)
    chapter: str | None = Field(default=None, max_length=120)
    page_start: int | None = Field(default=None, ge=1, le=20000)
    page_end: int | None = Field(default=None, ge=1, le=20000)
    resource_id: str | None = None


class ExamAttempt(BaseDocument):
    date: date
    minutes: int = Field(ge=1, le=1440)
    score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    notes: str = Field(default='', max_length=1000)


class Resource(BaseDocument):
    course_id: str
    week_number: int | None = Field(default=None, ge=1, le=30)  # None = shared Course Library.
    title: str = Field(min_length=1, max_length=240)
    kind: Literal['slides', 'annotated', 'handwritten', 'textbook', 'exam_paper', 'exam_solution', 'other'] = 'other'
    source: Literal['drive', 'dtu', 'link']
    url: HttpUrl | None = None
    drive_file_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{5,200}$')
    item_id: str | None = None
    last_page: int = Field(default=1, ge=1, le=20000)
    exam_attempts: list[ExamAttempt] = Field(default_factory=list, max_length=100)
    chapter: str = Field(default='', max_length=120)
    page_start: int | None = Field(default=None, ge=1, le=20000)
    page_end: int | None = Field(default=None, ge=1, le=20000)

    @model_validator(mode='after')
    def valid_location(self):
        if self.exam_attempts and self.kind != 'exam_paper':
            raise ValueError('Only exam papers can have attempts')
        if len({a.id for a in self.exam_attempts}) != len(self.exam_attempts):
            raise ValueError('Attempt IDs must be unique')
        if self.week_number is None and self.item_id is not None:
            raise ValueError('Shared course resources cannot be attached to one weekly item')
        if self.page_start is not None and self.page_end is not None and self.page_end < self.page_start:
            raise ValueError('End page cannot precede start page')
        if self.source == 'drive' and not self.drive_file_id:
            raise ValueError('A Drive resource requires a Google Drive file ID')
        if self.source != 'drive' and not self.url:
            raise ValueError('A link resource needs an HTTP(S) URL')
        return self


class FocusSession(BaseDocument):
    course_id: str | None = None
    item_id: str | None = None
    week_number: int | None = Field(default=None, ge=1, le=30)
    mode: Literal['25', '50', '90', 'free'] = '50'
    status: Literal['running', 'paused', 'finished'] = 'running'
    started_at: int
    pause_started_at: int | None = None
    accumulated_pause_seconds: int = 0
    ended_at: int | None = None
    focus_seconds: int | None = None


class StartFocus(BaseModel):
    course_id: str | None = None
    item_id: str | None = None
    week_number: int | None = Field(default=None, ge=1, le=30)
    mode: Literal['25', '50', '90', 'free'] = '50'
    requested_at: int | None = Field(default=None, ge=1)


class PauseFocus(BaseModel):
    # A voluntary downward correction prevents API latency from adding focus time.
    # Never permit an increase beyond the server-calculated unpaused duration.
    displayed_seconds: int | None = Field(default=None, ge=0, le=86400)


class ResumeFocus(BaseModel):
    # Optional click timestamp to prevent network latency extending a pause.
    requested_at: int | None = Field(default=None, ge=1)


class FinishFocus(BaseModel):
    confirmed_seconds: int | None = Field(default=None, ge=0, le=86400)


class ReadingPosition(BaseModel):
    page: int = Field(ge=1, le=20000)
