import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const home=read('app/page.tsx');
const study=read('components/course-planner.tsx');
const css=read('app/globals.css');

test('Home keeps all four metrics while giving courses/priorities the left column',()=>{
  for(const heading of ['Tasks today','Overdue','Upcoming deadlines','Focus this week','Today’s study courses','Today’s priorities','Next 7 days']) assert.ok(home.includes(heading));
  assert.match(css,/\.home-course-panel\{grid-column:1;grid-row:2\}/);
  assert.match(css,/\.home-priorities\{grid-column:1;grid-row:3\}/);
  assert.match(css,/\.home-side-column\{grid-column:2;grid-row:2 \/ span 2\}/);
  assert.match(css,/\.home-course-grid\.course-count-1\{grid-auto-columns:100%\}/);
});
test('Home avoids empty deadline repetition and redundant Today badges',()=>{
  assert.match(home,/\{upcoming\.length>0&&<section className="home-panel home-deadlines"/);
  assert.doesNotMatch(home,/No upcoming deadlines\./);
  assert.match(home,/group\.overdueCount>0&&<span className="home-overdue-pill"/);
  assert.doesNotMatch(home,/home-today-pill">Today/);
  assert.match(home,/overdue\.length\?"red":"purple"/);
  assert.match(home,/isOverdue\(i,today\)&&<span className="home-priority-tag overdue">Overdue/);
});
test('Study header is contextual and the weekly checklist hides duplicated checklist-only labels',()=>{
  assert.match(study,/in this semester/);
  assert.doesNotMatch(study,/Choose a course to continue your week/);
  assert.doesNotMatch(study,/planner-activity-pill checklist-only/);
  assert.match(study,/hidden_from_tasks/);
});
test('Study Tasks has correct current-week and exam filters without duplicating activities',()=>{
  assert.match(study,/courseTaskFilter==='week'\?i\.week_number===weekNumber:i\.week_number===null/);
  assert.match(study,/filteredCourseTasks\.map\(renderCourseTask\)/);
  assert.match(study,/All':filter==='week'\?'This week':'Exam prep'/);
  assert.match(study,/activityReference\(i\)/);
  assert.match(study,/Remove from Tasks/);
  assert.match(study,/Delete permanently/);
  assert.match(study,/toggleItem\(i\)/);
});
test('Exam Prep keeps one shared row style and uses on-demand creation with progress',()=>{
  assert.match(study,/examItems\.map\(renderCourseTask\)/);
  assert.match(study,/planner-exam-progress/);
  assert.match(study,/examEntryOpen\?<form/);
  assert.match(study,/Add revision task/);
  assert.match(study,/setExamEntryOpen\(false\)/);
});
test('Course form uses full-width title/goals, semester naming and dirty-form protection',()=>{
  assert.match(study,/planner-course-form-grid/);
  assert.match(study,/planner-form-full"><FormRow label="Course title"/);
  assert.match(study,/planner-form-full"><FormRow label="Study goals \(optional\)"/);
  assert.match(study,/Edit semester':'Add semester'/);
  assert.match(study,/Discard your unsaved changes\?/);
  assert.match(study,/onClick=\{closeDialog\}>Cancel/);
  assert.match(css,/\.planner-dialog \.planner-course-form-grid/);
  assert.match(css,/@media\(max-height:760px\)/);
});
