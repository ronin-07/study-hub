import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {todayStudyCourses} from '../lib/home-view.ts';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url),'utf8');
const planner = read('components/course-planner.tsx');
const home = read('app/page.tsx');
const css = read('app/globals.css');
const taskMenu=read('components/task-actions-menu.tsx');

test('Exam Prep editor presents course-wide revision records as Exam preparation, preserving the old data kind',()=>{
  assert.match(planner,/setEditingExamPrep\(Boolean\(item && item\.week_number === null && item\.kind === 'revision'\)\)/);
  assert.match(planner,/editingExamPrep\?<><input value="Exam preparation" readOnly/);
  assert.doesNotMatch(planner,/Weekly Revision activities remain separate/);
  assert.match(planner,/kind:'revision',is_task:true,title:examTitle\.trim\(\)/);
});

test('Exam Prep completion totals use canonical state, not held animation rows',()=>{
  assert.match(planner,/const examProgressItems = examPreparationItems\(progressItems,selectedId\)/);
  assert.match(planner,/const examDoneCount = examProgressItems\.filter\(i => i\.done\)\.length/);
  assert.match(planner,/<Badge>\{examDoneCount\}\/\{examProgressItems\.length\} completed<\/Badge>/);
  assert.match(css,/\.planner-exam-card \.planner-course-task-row\.is-done:not\(\.is-completing\)/);
});

test('action menus portal outside the clipped card and flip up near bottom of viewport',()=>{
  assert.match(planner,/function CourseTaskActionMenu/);
  assert.match(planner,/TaskActionsMenu/);
  assert.match(taskMenu,/createPortal\(/);
  assert.match(taskMenu,/rect\.top-menuHeight-gap/);
  assert.match(taskMenu,/below\+menuHeight<=window\.innerHeight-edge/);
  assert.match(taskMenu,/window\.addEventListener\('scroll',close,true\)/);
  assert.match(taskMenu,/event\.key==='Escape'/);
  assert.match(css,/\.planner-task-floating-menu\{position:fixed/);
  assert.doesNotMatch(planner,/<details className="planner-task-more">/);
});

test('Open course uses remembered per-course week, not arbitrary first today task',()=>{
  assert.match(home,/onClick=\{\(\)=>openCourse\(group\.course\.id\)\}>Open course/);
  assert.match(home,/const saved=Number\(window\.localStorage\.getItem\(`studyhub-last-week-\$\{id\}`\)\)\|\|1/);
  assert.match(home,/const restoredCourseRef=useRef\(''\)/);
  assert.doesNotMatch(home,/openCourse\(group\.course\.id,group\.tasks\[0\]/);
});

test('daily progress is scoped to scheduled work even for mixed weeks and completed tasks',()=>{
  const course={id:'c',code:'02456',title:'Deep learning',week_count:8};
  const make=(id,week_number,date,done=false)=>({id,course_id:'c',week_number,planned_date:date,due_date:null,is_task:true,kind:'reading',done,priority:'medium',title:id});
  const list=[make('today-1',1,'2026-11-23'),make('today-2',4,'2026-11-23',true),make('other-1',1,null),make('other-4',4,null)];
  const group=todayStudyCourses([course],list,'2026-11-23')[0];
  assert.deepEqual(group.weekNumbers,[1,4]);
  assert.equal(group.todayCount,2);
  assert.equal(group.doneCount,1);
  assert.equal(group.activityCount,2);
  assert.match(home,/Today’s progress/);
});
