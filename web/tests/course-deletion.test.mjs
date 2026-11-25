import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const planner=readFileSync(new URL('../components/course-planner.tsx',import.meta.url),'utf8');
const dialog=readFileSync(new URL('../components/course-deletion-dialog.tsx',import.meta.url),'utf8');

test('permanent course deletion is only offered in archived course controls',()=>{
  assert.match(planner,/isReadOnly\?<><Badge>Archived · read only<\/Badge>[^\n]*setDeletionCourse\(selected\)[^\n]*Delete permanently/);
  assert.match(planner,/CourseDeletionDialog key=\{deletionCourse.id\}/);
});
test('course deletion requires a server preview and exact typed confirmation',()=>{
  assert.match(dialog,/\/deletion-preview/);
  assert.match(dialog,/confirmation!==['"]DELETE['"]/);
  assert.match(dialog,/preview\.blockers\.length/);
  assert.match(dialog,/preview_token:preview\.preview_token/);
  assert.match(dialog,/submitGuard\.current/);
  assert.match(dialog,/\/permanent-delete/);
  assert.match(dialog,/undefined,\{title:'Course permanently deleted'/);
});
