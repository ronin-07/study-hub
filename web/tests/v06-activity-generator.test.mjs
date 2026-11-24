import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultActivities, generationSummary, teachingWeeks, normalizedActivityName } from '../lib/activity-generator.ts';
import { applyMutation, preserveWorkspaceChanges } from '../lib/snapshot-cache.ts';
import { isActionable } from '../lib/task-view.ts';

test('six defaults preserve the distinction between assignment and independent exercise',()=>{
  assert.equal(defaultActivities.length,6);
  const assignment=defaultActivities.find(a=>a.title==='Assignments');
  const exercise=defaultActivities.find(a=>a.title==='Exercises');
  assert.equal(assignment.kind,'assignment');assert.equal(exercise.kind,'exercise');
  assert.equal(isActionable({...assignment,is_task:false}),true);
  assert.equal(isActionable({...exercise,is_task:false}),false);
  assert.equal(isActionable({...exercise,is_task:false,planned_date:'2026-11-24'}),true);
  assert.deepEqual(generationSummary([],'course',defaultActivities,teachingWeeks(13)),{potential:78,skipped:0,created:78});
});
test('summary counts distinct selected matches and ignores other courses and course-wide items',()=>{
  const items=[{title:' LECTURE   slides ',course_id:'c',week_number:1},{title:'Lecture slides',course_id:'c',week_number:1},{title:'Lecture slides',course_id:'other',week_number:2},{title:'Lecture slides',course_id:'c',week_number:null}];
  assert.equal(normalizedActivityName('  LECTURE  slides '),'lecture slides');
  assert.deepEqual(generationSummary(items,'c',[defaultActivities[0]],[1,2]),{potential:2,skipped:1,created:1});
  assert.deepEqual(generationSummary(items,'c',[],[]),{potential:0,skipped:0,created:0});
});
test('bulk insert reconciles a lost response without overwriting an existing local record or losing new rows to stale snapshots',()=>{
  const initial={items:[{id:'existing',done:true}],courses:[],weeks:[],resources:[],sessions:[],semesters:[]};
  const result={items:[{id:'existing',done:false},{id:'new',done:false}]};
  const updated=applyMutation(initial,{collection:'items',bulkInsert:true},result);
  assert.deepEqual(updated.items,[{id:'existing',done:true},{id:'new',done:false}]);
  assert.deepEqual(applyMutation(updated,{collection:'items',bulkInsert:true},result).items,updated.items);
  assert.deepEqual(preserveWorkspaceChanges(initial,updated,{items:new Set(['new'])},new Set()).items,updated.items);
});
