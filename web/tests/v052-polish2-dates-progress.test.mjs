import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {courseLearningItems,examPreparationItems} from '../lib/study-progress.ts';
import {upcomingSections,canPlanOnDate} from '../lib/task-view.ts';
const read = f=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8');
const tasks=read('components/tasks-planner.tsx');
const study=read('components/course-planner.tsx');
const menu=read('components/task-actions-menu.tsx');
const css=read('app/globals.css');
const item=(id,overrides={})=>({id,title:id,course_id:'machine-learning',week_number:1,kind:'reading',done:false,
  hidden_from_tasks:false,is_task:true,planned_date:null,due_date:null,priority:'medium',...overrides});

test('course progress counts week-linked learning, independent of Tasks visibility and Exam Prep',()=>{
  const items=[item('week1'),item('week4',{week_number:4,done:true,hidden_from_tasks:true}),item('unknown-week',{week_number:undefined}),
    item('exam',{week_number:null,kind:'revision',done:true}),item('other',{course_id:'different',done:true})];
  const course=courseLearningItems(items,'machine-learning');
  const exam=examPreparationItems(items,'machine-learning');
  assert.deepEqual(course.map(i=>i.id),['week1','week4']);
  assert.deepEqual(exam.map(i=>i.id),['exam']);
  assert.equal(course.filter(i=>i.done).length,1);
  assert.match(study,/No learning activities yet/);
  assert.match(study,/Course progress<\/span>/);
  assert.doesNotMatch(study,/Course-wide Exam Prep task\. Weekly Revision activities remain separate/);
});

test('upcoming is separated into scheduled and truly unscheduled tasks',()=>{
  const future=upcomingSections([
    item('scheduled',{planned_date:'2026-11-25'}),
    item('due-not-planned',{due_date:'2026-11-28'}),
    item('no-date'),
    item('today',{planned_date:'2026-11-23'}),
    item('finished',{planned_date:'2026-11-27',done:true})],'2026-11-23');
  assert.deepEqual(future.scheduled.map(i=>i.id),['scheduled']);
  assert.deepEqual(future.unscheduled.map(i=>i.id),['due-not-planned','no-date']);
  assert.equal(canPlanOnDate({due_date:'2026-11-25'},'2026-11-26'),false);
  assert.equal(canPlanOnDate({due_date:'2026-11-25'},'2026-11-24'),true);
});

test('calendar has separate unscheduled tray, concise selected day and date-prefilled task creation',()=>{
  assert.match(tasks,/planner-v052-calendar-summary/);
  assert.match(tasks,/planner-v052-unscheduled/);
  assert.match(tasks,/selectedDay&&i.planned_date!==selectedDay/);
  assert.match(tasks,/due\.map\(i=>showRow\(i,false,false,'due'\)\)/);
  assert.match(tasks,/onClick=\{\(\)=>startCreate\(selectedDay\)\}/);
  assert.match(tasks,/body:\{planned_date:date\}/);
  assert.match(tasks,/mode==='completed'\?"View today's tasks"/);
  assert.match(tasks,/upcomingUnscheduled\.map/);
  assert.doesNotMatch(tasks,/Upcoming & unscheduled/);
});

test('Study and Global Tasks share the same viewport-aware contextual menu',()=>{
  assert.match(study,/TaskActionsMenu/);
  assert.match(tasks,/TaskActionsMenu/);
  assert.match(menu,/createPortal/);
  assert.match(menu,/rect\.top-menuHeight-gap/);
  assert.match(menu,/Remove from Tasks/);
  assert.match(menu,/Delete permanently/);
  assert.match(menu,/event\.key==='Escape'/);
});

test('highlight rows have stable inset padding in light, dark and narrow layouts',()=>{
  assert.match(css,/planner-learning-checklist \.planner-activity-detail\.planner-target-item/);
  assert.match(css,/padding:15px 13px;border-color/);
  assert.match(css,/planner-course-task-row\.planner-target-item/);
  assert.match(css,/planner-v05-task\.planner-target-item/);
  assert.match(css,/@media\(max-width:810px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
