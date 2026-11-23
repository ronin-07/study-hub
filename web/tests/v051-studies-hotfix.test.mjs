import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isActionable } from '../lib/task-view.ts';

const read = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const study = read('components/course-planner.tsx');
const tasks = read('components/tasks-planner.tsx');
const css = read('app/globals.css');

test('hidden weekly items remain in Study but are excluded from all task projections', () => {
  const base = {is_task:true,kind:'reading',planned_date:'2026-11-23',due_date:'2026-11-24'};
  assert.equal(isActionable({...base,hidden_from_tasks:false}),true);
  assert.equal(isActionable({...base,hidden_from_tasks:true}),false);
  assert.equal(isActionable({...base,kind:'assignment',hidden_from_tasks:true}),false);
  assert.equal(isActionable({...base,hidden_from_tasks:undefined}),true);
  assert.match(study,/hidden_from_tasks:true/);
  assert.match(study,/i\.course_id === selectedId && i\.week_number === weekNumber/);
  assert.match(tasks,/hidden_from_tasks:true/);
  assert.match(tasks,/Remove from Tasks/);
  assert.match(tasks,/Delete permanently/);
});

test('activity edit allows chapter, note, kind and visibility updates',()=>{
  assert.match(study,/openActivityForm\(i\)/);
  assert.match(study,/editActivityId \? `\/api\/items\/\$\{editActivityId\}`/);
  assert.match(study,/chapter: item\.chapter \|\| ''/);
  assert.match(study,/resource_id: item\.resource_id \|\| ''/);
  assert.match(study,/Include in Tasks and Calendar/);
});

test('overview retains scrollable full library; exam categories remain in document type only',()=>{
  assert.doesNotMatch(study,/className="planner-study-notes-card"/);
  assert.doesNotMatch(study,/shared\.slice\(0,3\)/);
  assert.match(study,/planner-study-library-scroll/);
  assert.match(study,/exam_paper/);
  assert.match(study,/exam_solution/);
  assert.doesNotMatch(study,/planner-study-library-actions/);
  assert.doesNotMatch(study,/<Plus size=\{14\}\/> Past paper/);
  assert.doesNotMatch(study,/<Plus size=\{14\}\/> Solution/);
  assert.match(css,/html\{font-size:18px\}/);
  assert.match(css,/\.planner-study-chapters/);
  assert.match(css,/\.planner-learning-checklist \.planner-study-task>div>small\{[^}]*font-size:\.72rem/);
  assert.match(css,/\.planner-study-chapters\{[^}]*font-size:\.82rem/);
  assert.match(css,/\.planner-study-library-scroll\{[^}]*overflow-y:auto/);
});
