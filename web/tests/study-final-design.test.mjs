import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const course=read('components/course-planner.tsx');
const home=read('app/page.tsx');
const css=read('app/globals.css');

test('semester and course hierarchy use course numbers rather than arbitrary color markers',()=>{
  assert.match(course,/className="planner-semester-code">\{c\.code\}/);
  assert.match(course,/className="planner-semester-course-name">\{c\.title\}/);
  assert.doesNotMatch(course,/planner-semester-dot/);
  assert.match(home,/className="sidebar-course-code">\{c\.code\}/);
  assert.doesNotMatch(home,/className=\{'sidebar-course-dot/);
});

test('clicking a selected semester again collapses it, while selecting another changes courses',()=>{
  assert.match(course,/if \(key === currentSemesterKey\) toggleSemester\(key\)/);
  assert.match(course,/else chooseSemester\(key\)/);
  assert.match(course,/onClick=\{\(\)=>onSemesterRowClick\(s\.key\)\}/);
  assert.match(course,/studyhub-expanded-semesters/);
});

test('creation and editing live in their appropriate workspaces',()=>{
  assert.match(course,/id="study-create-menu"/);
  assert.match(course,/New semester/);
  assert.match(course,/New course/);
  assert.match(course,/Edit semester/);
  assert.match(course,/Edit course/);
  assert.match(course,/More course actions/);
  assert.match(course,/Archive course/);
  assert.doesNotMatch(course,/planner-course-actions-section/);
});

test('all five established course tabs are preserved with week-specific functionality',()=>{
  for(const tab of ['Overview','Course library','Week resources','Study tasks','Exam prep']) assert.ok(course.includes(tab));
  assert.match(course,/planner-study-overview/);
  assert.match(course,/aria-label="Teaching week"/);
  assert.match(course,/setWorkspaceTab\('course-library'\)/);
  assert.match(course,/setWorkspaceTab\('week-resources'\)/);
});

test('overview filters are scoped to selected course and teaching week',()=>{
  assert.match(course,/i\.course_id === selectedId && i\.week_number === weekNumber/);
  assert.match(course,/courseItems = data\.items\.filter\(i => i\.course_id === selectedId\)/);
  assert.match(course,/activityFilter==='completed'/);
  assert.match(course,/activityFilter==='planned'/);
  assert.match(course,/Boolean\(i\.due_date\)/);
  assert.match(course,/isOverdue\(i,today\)/);
});

test('quick notes are real per-week records with editable Firebase-backed text',()=>{
  assert.match(course,/const weekNotes=items\.filter\(i=>i\.kind==='notes'\)/);
  assert.match(course,/setItemDraft\(\{\.\.\.itemDraftDefaults,kind:'notes',is_task:false\}\)/);
  assert.match(course,/method:'PATCH',body:\{title:noteDraft\.title\.trim\(\),notes:noteDraft\.notes\}/);
  assert.match(course,/maxLength=\{5000\}/);
  assert.match(course,/\{collection:'items'\}/);
});

test('responsive Study layout and unified header have dedicated styles',()=>{
  assert.match(css,/\.planner-study-overview\{grid-template-columns:/);
  assert.match(css,/\.planner-study-tabs button\.active/);
  assert.match(css,/\.planner-semester-row-action:hover/);
  assert.match(css,/\.topbar-datetime\{/);
  assert.match(home,/className="topbar-datetime"/);
});
