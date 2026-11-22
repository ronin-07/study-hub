import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMPLETION_HOLD_MS, COMPLETION_EXIT_MS, presentCompletingItems } from '../lib/task-completion-presentation.ts';
import { todayPriorities } from '../lib/task-view.ts';
import { todayStudyCourses } from '../lib/home-view.ts';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const page = read('app/page.tsx');
const study = read('components/course-planner.tsx');
const tasks = read('components/tasks-planner.tsx');
const pdf = read('components/pdf-workspace.tsx');
const css = read('app/globals.css');

const task = {id:'task-1',title:'Read slides',done:true,is_task:true,kind:'revision',
  course_id:'course-1',week_number:1,planned_date:'2026-11-22',due_date:null,priority:'medium',repeat:'none'};

test('completion has a 750ms visual hold and 150ms exit, never delays the write',()=>{
  assert.equal(COMPLETION_HOLD_MS,750);
  assert.equal(COMPLETION_EXIT_MS,150);
  assert.match(page,/startCompletion\(item\.id\)/);
  assert.match(page,/method:'PATCH',body:\{done:!item\.done\}/);
  assert.match(page,/if\(record\.saved\)beginCompletionExit\(id\)/);
  assert.match(page,/if\(record\.minimumElapsed\)beginCompletionExit\(id\)/);
});

test('completion projection retains the same row in active views, then releases it',()=>{
  const original=[task];
  const held=presentCompletingItems(original,{'task-1':'holding'});
  assert.equal(original[0].done,true,'the canonical task must remain saved as completed');
  assert.equal(held.length,1);
  assert.equal(held[0].done,false);
  assert.equal(todayPriorities(held,'2026-11-22').length,1);
  const course={id:'course-1',code:'02516',title:'Image Analysis',archived:false};
  assert.equal(todayStudyCourses([course],held,'2026-11-22')[0].tasks.length,1);
  assert.equal(presentCompletingItems(original,{'task-1':'leaving'})[0].done,false);
  assert.equal(presentCompletingItems(original,{})[0].done,true);
  assert.equal(todayPriorities(presentCompletingItems(original,{}),'2026-11-22').length,0);
  assert.strictEqual(presentCompletingItems(original,{}),original,'avoid cloning idle snapshots');
});

test('failure, auth changes, and reduced-motion bypass cancel completion animation',()=>{
  assert.match(page,/clearCompletion\(item\.id\);\s*setData\(previous=>/);
  assert.match(page,/completionTimersRef\.current\.clear\(\);setCompletionPhases\(\{\}\)/);
  assert.match(page,/prefers-reduced-motion: reduce/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('all checklist surfaces use the shared controlled checkbox and visual row classes',()=>{
  for (const src of [page,study,tasks,pdf]) {
    assert.match(src,/task-completion-check/);
    assert.match(src,/is-completing/);
  }
  assert.match(study,/activityFilter==='planned'\|\|activityFilter==='due'/);
  assert.match(tasks,/removeOnComplete&&exitingIds\.has/);
  assert.doesNotMatch(pdf,/is-exiting/);
  assert.match(page,/items=\{presentedItems\}/);
  assert.match(page,/data\.items===presentedItems\?data:\{\.\.\.data,items:presentedItems\}/);
  assert.match(css,/task-completion-text/);
  assert.match(css,/task-completion-exit/);
});

test('persistent weekly, calendar, and PDF rows do not fade out then reappear',()=>{
  assert.match(tasks,/scheduled\.map\(i=>showRow\(i,true\)\)/);
  assert.match(tasks,/inbox\.map\(i=>showRow\(i,true,true\)\)/);
  assert.match(tasks,/listed\.map\(i=>showRow\(i,false,mode!==\'completed\'\)\)/);
  assert.match(css,/\.pdf-check \.task-completion-check:checked \+ span/);
});
