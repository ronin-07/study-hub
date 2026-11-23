import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const study = read('components/course-planner.tsx');
const tasks = read('components/tasks-planner.tsx');
const home = read('app/page.tsx');
const css = read('app/globals.css');
const display = read('lib/activity-display.ts');

test('Study checklist keeps full context but removes duplicate kind labels', () => {
  assert.match(study, /className="planner-activity-heading"/);
  assert.match(study, /const reference=activityReference\(i\)/);
  assert.match(study, /const fallback=activityKindFallback\(i\)/);
  assert.match(study, /planner-activity-reference/);
  assert.match(study, /Pages \{i\.page_start/);
  assert.match(study, /shortStudyDate\(i\.planned_date\)/);
  assert.match(study, /shortStudyDate\(i\.due_date\)/);
  assert.match(study, /document\.title/);
  assert.match(study, /<details className="planner-activity-notes">/);
  assert.match(study, /!isActionable\(i\).*Checklist only/);
  assert.doesNotMatch(study, /Open document <ExternalLink/);
});

test('Existing checklist buttons still edit, schedule, focus, delete and complete same item', () => {
  for (const action of ['openActivityForm(i)', 'openActivityPlan(i)', 'focusOn(i)', 'deleteItem(i)', 'toggleItem(i)']) {
    assert.ok(study.includes(action), `${action} must remain`);
  }
  assert.match(study, /aria-label=\{`Complete \$\{i.title\}`\}/);
  assert.match(study, /role="group" aria-label=\{`\$\{i.title\} actions`\}/);
  assert.match(css, /\.planner-activity-actions/);
});

test('Questions, chapters and dotted references share stable labels and remain unmodified in storage', () => {
  assert.match(display, /item\.kind === 'questions' \? 'Questions'/);
  assert.match(display, /item\.kind === 'reading' \? 'Chapters'/);
  assert.match(display, /formatStudyReference\(item\.chapter\)/);
  assert.match(display, /Stored question\/chapter text is untouched/);
});

test('Tasks are concise and Calendar remains date-first with an expandable agenda', () => {
  assert.match(tasks, /planner-v05-task-context/);
  assert.match(tasks, /planner-v05-task-reference/);
  assert.match(tasks, /planner-v05-task-primary-date/);
  assert.match(tasks, /<details className="planner-v05-task-extra">/);
  assert.match(tasks, /calendarRole==='due'\?'Deadline':i\.due_date===selectedDay\?'Planned and due':'Planned work'/);
  assert.match(tasks, /scheduled\.map\(i=>showRow\(i,true,false,'planned'\)\)/);
  assert.match(tasks, /due\.map\(i=>showRow\(i,false,false,'due'\)\)/);
  assert.match(tasks, /i\.due_date===selectedDay&&i\.planned_date!==selectedDay/);
  assert.match(tasks, /onToggle\(i\)/);
  assert.match(tasks, /onOpenResource\(i\)/);
});

test('Home shows course context once and reserves actionable rows for priorities', () => {
  assert.match(home, /home-course-overview/);
  assert.match(home, /home-course-workload/);
  assert.doesNotMatch(home, /className=\"home-course-activities\"/);
  assert.match(home, /activityReference\(i\)/);
  assert.match(home, /onClick=\{\(\)=>openDeadlineDestination\(i\)\}/);
  assert.match(home, /onClick=\{\(\)=>startFrom\(i\)\}/);
  assert.match(css, /\.home-course-overview/);
});

test('Study typography stays aligned to v0.5.1 scale and mobile actions cannot overlap metadata', () => {
  assert.match(css, /html\{font-size:18px\}/);
  assert.match(css, /\.planner-activity-reference\{/);
  assert.match(css, /\.planner-activity-metadata\{/);
  assert.match(css, /\.planner-activity-document\{/);
  assert.match(css, /@media\(max-width:1180px\)/);
  assert.match(css, /\.planner-activity-actions\{grid-column:2/);
  assert.match(css, /@media\(max-width:650px\)/);
  assert.match(css, /\.app-shell:not\(\.theme-dark\) \.planner-activity-reference/);
});
