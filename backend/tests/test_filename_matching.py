"""Pure filename suggestion regressions (no credentials or API dependencies)."""
import pytest
from app.matching import course_acronym, suggest

CV = dict(id='cv', code='02516', title='Introduction to Deep Learning in Computer Vision', week_count=13)
ML = dict(id='ml', code='02450', title='Introduction to Machine Learning', week_count=13)

@pytest.mark.parametrize('name,week', [
    ('IDLCV_L5_VideoClassification.pdf', 5), ('IDLCV_L06.pdf', 6),
    ('IDLCV_L_7_MortalSins.pdf', 7), ('IDLCV_W05.pdf', 5),
    ('IDLCV_Week_5.pdf', 5), ('IDLCV_Lecture-5.pdf', 5), ('IDLCV_Lec.05.pdf', 5),
])
def test_unique_acronym_and_week(name, week):
    assert course_acronym(CV['title']) == 'idlcv'
    result = suggest('Goodnotes', name, [CV, ML], [])
    assert (result['course_id'], result['week_number'], result['kind'], result['confidence']) == ('cv', week, 'slides', 'low')

@pytest.mark.parametrize('name', ['IDLCV_modelL5.pdf', 'IDLCV_L5abc.pdf', 'IDLCV_L00.pdf', 'IDLCV_Week5_L6.pdf', 'IDLCV_W2026.pdf', 'IDLCV_L14.pdf', 'notIDLCV_L5.pdf'])
def test_ambiguous_or_invalid_filename(name):
    assert suggest('Goodnotes', name, [CV, ML], []) is None


def test_acronym_collision_code_precedence_and_archived_courses():
    collision = dict(CV, id='other', code='00001')
    assert suggest('Goodnotes', 'IDLCV_L5.pdf', [CV, collision], []) is None
    assert suggest('Goodnotes', '02516_IDLCV_L5.pdf', [CV, collision], [])['course_id'] == 'cv'
    assert suggest('Goodnotes', 'IDLCV_L5.pdf', [CV, dict(collision, archived=True)], [])['course_id'] == 'cv'
    assert suggest('Goodnotes/Week 6', 'IDLCV_L5.pdf', [CV, ML], []) is None
