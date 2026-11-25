"""v0.4 backwards-compatible workspace update schemas."""
from datetime import date, time
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator
from .models import BaseDocument


class Semester(BaseDocument):
    name: str = Field(min_length=1, max_length=60)
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode='after')
    def coherent(self):
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError('Semester must end after it begins')
        return self


class SemesterPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str | None = Field(default=None, min_length=1, max_length=60)
    start_date: date | None = None
    end_date: date | None = None


class CoursePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str | None = Field(default=None, min_length=2, max_length=40)
    title: str | None = Field(default=None, min_length=1, max_length=180)
    semester: str | None = Field(default=None, min_length=1, max_length=60)
    semester_id: str | None = None
    week_count: int | None = Field(default=None, ge=1, le=30)
    exam_date: date | None = None
    exam_time: time | None = None
    exam_duration_minutes: int | None = Field(default=None, ge=1, le=720)
    exam_location: str | None = Field(default=None, max_length=240)
    exam_format: str | None = Field(default=None, max_length=80)
    goals: str | None = Field(default=None, max_length=2000)


class WeekPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str | None = Field(default=None, min_length=1, max_length=180)
    objectives: str | None = Field(default=None, max_length=3000)


class ResourcePatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    week_number: int | None = Field(default=None, ge=1, le=30)
    title: str | None = Field(default=None, min_length=1, max_length=240)
    kind: str | None = Field(default=None, pattern=r'^(slides|annotated|handwritten|textbook|exam_paper|exam_solution|other)$')
    item_id: str | None = None
    exam_paper_id: str | None = Field(default=None, pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    chapter: str | None = Field(default=None, max_length=120)
    page_start: int | None = Field(default=None, ge=1, le=20000)
    page_end: int | None = Field(default=None, ge=1, le=20000)
    # Source file/URL is immutable. Week scope can change without moving or copying the source.

