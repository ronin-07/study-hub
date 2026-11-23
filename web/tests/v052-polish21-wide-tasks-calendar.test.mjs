import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {upcomingSections} from '../lib/task-view.ts';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url),'utf8');
const tasks = read('components/tasks-planner.tsx');
const css = read('app/globals.css');
const task = (id, rest={})=>({
  id, title:id, priority:'medium', done:false, is_task:true, kind:'revision',
  planned_date:null, due_date:null, ...rest
});

test('global task rows use full-width responsive columns and right-aligned actions',()=>{
  assert.match(tasks, /!calendarOnly\?' planner-v052-task-row'/);
  assert.match(tasks, /planner-v052-row-date/);
  assert.match(css, /grid-template-columns:20px minmax\(0,1fr\) minmax\(126px,160px\) auto/);
  assert.match(css, /\.planner-v052-task-row \.planner-v05-taskbody\{width:100%;max-width:none/);
  assert.match(css, /\.planner-v052-task-row \.planner-v05-row-actions\{[^}]*justify-self:end/);
  assert.match(css, /\.planner-v052-task-row\.planner-target-item/);
  assert.match(css, /\.planner-v052-task-row\.is-completing/);
  assert.match(css, /@container \(max-width:770px\)/);
  assert.match(css, /@container \(max-width:500px\)/);
});

test('deadline-only tasks stay unscheduled and display due date and planning status',()=>{
  const {scheduled,unscheduled}=upcomingSections([
    task('due only',{due_date:'2026-11-26'}),
    task('planned',{planned_date:'2026-11-25',due_date:'2026-11-26'}),
  ],'2026-11-23');
  assert.deepEqual(scheduled.map(i=>i.id),['planned']);
  assert.deepEqual(unscheduled.map(i=>i.id),['due only']);
  assert.match(tasks, /Due \{shortStudyDate\(i\.due_date\)\}/);
  assert.match(tasks, /i\.due_date\?'Needs planning':'Not scheduled'/);
  assert.match(tasks, /unscheduled&&<button className="btn secondary small planner-v052-plan"/);
});

test('Calendar has one contextual task-creation action for populated or empty selected day',()=>{
  assert.match(tasks, /!calendarOnly&&<button className="btn primary" onClick=\{\(\)=>startCreate\(today\)\}/);
  assert.match(tasks, /\(scheduled\.length>0\|\|due\.length>0\)&&<button type="button" className="btn secondary small planner-v052-day-add"/);
  assert.match(tasks, /onClick=\{\(\)=>startCreate\(selectedDay\)\}/);
  assert.match(tasks, /actionLabel="Add task" onAction=\{\(\)=>startCreate\(selectedDay\)\}/);
  assert.match(css, /\.planner-v052-day-add\{display:inline-flex/);
});
