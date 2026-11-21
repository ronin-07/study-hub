"""Conservative, explainable suggestions for imported Goodnotes PDF filenames.

The app NEVER auto-links scanned files: the user confirms all associations.
"""
from __future__ import annotations

import re
from pathlib import PurePosixPath

WEEK_PATTERN = re.compile(r'(?i)(?:^|[^a-z0-9])(?:week|wk|lecture|lec|w|l)[\s._-]*0?([1-9]|[12]\d|30)(?=$|[^\d])')


def detect_kind(name: str) -> str:
    label = name.lower()
    if re.search(r'annotat|highlight|marked|goodnotes.*slide', label):
        return 'annotated'
    if re.search(r'handwrit|my[\s_-]*notes|notebook|notes', label):
        return 'handwritten'
    if re.search(r'textbook|chapter|\bch[\s._-]*\d|reading|book', label):
        return 'textbook'
    if re.search(r'slide|lecture|\blec\b|\bl\d+\b', label):
        return 'slides'
    return 'other'


def suggest(path: str, name: str, courses: list[dict], weeks: list[dict]) -> dict | None:
    """Return an optional candidate; unknown/ambiguous values are left for review."""
    context = f'{path}/{name}'.replace('\\', '/')
    hits = [int(m.group(1)) for m in WEEK_PATTERN.finditer(context)]
    week_number = hits[0] if hits and len(set(hits)) == 1 else None
    if week_number is None:
        return None

    # Code must occur as a whole token (not inside a long numeric filename).
    course_matches = [c for c in courses if re.search(r'(?<!\d)' + re.escape(c['code']) + r'(?!\d)', context, re.I)]
    if len(course_matches) == 1:
        course = course_matches[0]
        evidence = 'course code and week in folder/filename'
        confidence = 'high'
    elif not course_matches and len(courses) == 1:
        course = courses[0]
        evidence = 'week in filename; only one course exists (please verify)'
        confidence = 'low'
    else:
        return None
    if week_number > course['week_count']:
        return None
    known = next((w for w in weeks if w['course_id'] == course['id'] and w['number'] == week_number), None)
    return {
        'course_id': course['id'], 'course_code': course['code'],
        'week_number': week_number, 'week_title': known['title'] if known else None,
        'kind': detect_kind(name), 'confidence': confidence, 'reason': evidence
    }
