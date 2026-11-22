import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceSemester } from '../lib/course-navigation.ts';

const semesters = ['id:autumn', 'id:spring'];
test('Home course deep-link selects owning semester, not first semester', () => {
  assert.equal(resolveWorkspaceSemester(semesters, '', 'id:spring'), 'id:spring');
  assert.equal(resolveWorkspaceSemester(semesters, 'id:autumn', 'id:spring'), 'id:spring');
});
test('empty semesters preserve user selection; unknown selection falls back safely', () => {
  assert.equal(resolveWorkspaceSemester(semesters, 'id:spring', ''), 'id:spring');
  assert.equal(resolveWorkspaceSemester(semesters, 'invalid', ''), 'id:autumn');
  assert.equal(resolveWorkspaceSemester([], 'id:autumn', ''), '');
});
