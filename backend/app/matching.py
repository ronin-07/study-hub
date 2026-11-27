"""Conservative, explainable suggestions for imported Goodnotes PDF filenames.

The app NEVER auto-links scanned files: the user confirms all associations.
"""
from __future__ import annotations

import re

WEEK_PATTERN = re.compile(r'(?i)(?:^|[^a-z0-9])(?:lecture|week|lec|wk|l|w)[\s._-]*(\d{1,2})(?=$|[^a-z0-9])')


IGNORED_WORDS = {'a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'with', 'at', 'by', 'from'}

def course_acronym(title: str) -> str:
    return ''.join(w[0] for w in re.findall(r'[a-z0-9]+', title.lower()) if w not in IGNORED_WORDS)

def detect_kind(name: str) -> str:
    label = name.lower()
    if re.search(r'annotat|highlight|marked|goodnotes.*slide', label):
        return 'annotated'
    if re.search(r'handwrit|my[\s_-]*notes|notebook|notes', label):
        return 'handwritten'
    if re.search(r'textbook|chapter|\bch[\s._-]*\d|reading|book', label):
        return 'textbook'
    if re.search(r'slide|lecture', label) or WEEK_PATTERN.search(label):
        return 'slides'
    return 'other'


def suggest(path: str, name: str, courses: list[dict], weeks: list[dict]) -> dict | None:
    """Return an optional candidate; unknown/ambiguous values are left for review."""
    context = f'{path}/{name}'.replace('\\', '/')
    hits = [int(m.group(1)) for m in WEEK_PATTERN.finditer(context)]
    week_number = hits[0] if hits and len(set(hits)) == 1 else None
    if week_number is None or week_number < 1:
        return None

    courses = [c for c in courses if not c.get('archived', False)]
    # Code must occur as a whole token (not inside a long numeric filename).
    course_matches = [c for c in courses if re.search(r'(?<!\d)' + re.escape(c['code']) + r'(?!\d)', context, re.I)]
    if len(course_matches) == 1:
        course = course_matches[0]
        evidence = 'course code and week in folder/filename'
        confidence = 'high'
    elif not course_matches:
        tokens = set(re.findall(r'[a-z0-9]+', context.lower()))
        aliases = [c for c in courses if len(course_acronym(c.get('title', ''))) >= 3
                   and course_acronym(c.get('title', '')) in tokens]
        if len(aliases) == 1:
            course = aliases[0]
            evidence = 'course title acronym and week in folder/filename (please verify)'
        elif not aliases and len(courses) == 1:
            course = courses[0]
            evidence = 'week in filename; only one course exists (please verify)'
        else:
            return None
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
