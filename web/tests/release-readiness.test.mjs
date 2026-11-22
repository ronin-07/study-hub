import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const planner=read('components/tasks-planner.tsx');
const course=read('components/course-planner.tsx');
const home=read('app/page.tsx');
const css=read('app/globals.css');

test('calendar drag guards dates after task deadline before PATCH',()=>{
  assert.match(planner,/if\(!canPlanOnDate\(item,date\)\)/);
  assert.match(planner,/onDragEnd=\{\(\)=>\{setDraggedTaskId\(null\);setHoverDay\(''\);\}\}/);
  assert.match(planner,/onDragOver=\{e=>\{if\(draggedTask\)/);
  assert.match(planner,/drop-blocked/);
});
test('task and study forms constrain planned date to the deadline',()=>{
  assert.match(planner,/max=\{draft\.due_date\|\|undefined\}/);
  assert.match(planner,/formDateInvalid/);
  assert.match(course,/max=\{planItem\.due_date\|\|undefined\}/);
  assert.match(course,/date>planItem\.due_date/);
  assert.match(course,/max=\{itemDraft\.due_date\|\|undefined\}/);
});
test('course cards stay equally sized in a responsive scroller rather than stretching the last card',()=>{
  assert.doesNotMatch(home,/compact-wide/);
  assert.match(home,/studyGroups\.map\(\(group,index\)=>/);
  assert.match(css,/grid-auto-columns:calc\(\(100% - 28px\)\/3\)/);
  assert.match(css,/grid-auto-columns:calc\(\(100% - 14px\)\/2\)/);
  assert.match(css,/grid-auto-columns:100%/);
});
test('Plan for today is disabled when a weekly activity is already past its deadline',()=>{
  assert.match(course,/disabled=\{busy\|\|Boolean\(planItem\.due_date&&localToday\(\)>planItem\.due_date\)\}/);
});
