"""Deterministic after-completion task recurrence, with local-calendar date semantics.

A repeated task creates *one* next occurrence only on its first completion.
This is deliberately not a background scheduler: skipped days do not silently
create hundreds of tasks, and repeated PATCH requests remain idempotent.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from hashlib import sha256

from .models import Item


def next_date(current: date, cadence: str) -> date:
    if cadence == 'daily':
        return current + timedelta(days=1)
    if cadence == 'weekly':
        return current + timedelta(days=7)
    if cadence == 'monthly':
        year = current.year + (current.month == 12)
        month = current.month % 12 + 1
        return date(year, month, min(current.day, calendar.monthrange(year, month)[1]))
    raise ValueError('Unsupported recurrence cadence')


def next_occurrence(previous: Item) -> Item:
    """Build stable-ID next task; caller checks existence before storing."""
    if previous.repeat == 'none' or previous.planned_date is None:
        raise ValueError('Task has no recurrence schedule')
    next_plan = next_date(previous.planned_date, previous.repeat)
    series = previous.repeat_series_id or previous.id
    identifier = 'occ_' + sha256(f'{series}:{next_plan.isoformat()}'.encode('utf-8')).hexdigest()[:32]
    next_due = (previous.due_date + (next_plan - previous.planned_date)) if previous.due_date else None
    return previous.model_copy(update={
        'id': identifier, 'done': False, 'submitted': False,
        'planned_date': next_plan, 'due_date': next_due,
        'repeat_series_id': series,
    })
