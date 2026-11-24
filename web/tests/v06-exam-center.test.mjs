import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {examCountdown,upcomingExams,categoryInTitle,examFocusThisWeek,attemptSummary} from '../lib/exam-prep.ts';
test('date countdown uses calendar days and excludes past and archived exams',()=>{
  assert.equal(examCountdown('2026-12-08','2026-11-24'),'14d');
  assert.equal(examCountdown('2026-12-08','2026-12-08'),'Today');
  assert.equal(examCountdown('2026-12-08','2026-12-09'),'Exam passed');
  assert.equal(examCountdown('2026-10-26','2026-10-24'),'2d');
  const rows=[{id:'late',exam_date:'2026-12-08',code:'B'},{id:'first',exam_date:'2026-11-24',code:'A'},{id:'past',exam_date:'2026-11-23'},{id:'archived',archived:true,exam_date:'2026-11-24'},{id:'none'}];
  assert.deepEqual(upcomingExams(rows,'2026-11-24').map(c=>c.id),['first','late']);
});
test('all standard labels suppressed but custom labels remain useful',()=>{
  for(const [title,kind] of [['Lecture slides','lecture'],['Book reading','reading'],['Book questions','questions'],['Past year questions','questions'],['Assignments','assignment'],['Exercises','exercise']])assert.equal(categoryInTitle(title,kind),true);
  assert.equal(categoryInTitle('Lab preparation','exercise'),false);
  assert.equal(categoryInTitle('Questionnaire design','questions'),false);
});
test('exam focus excludes unlinked, weekly, unfinished, other-course and old sessions',()=>{
  const now=new Date(2026,10,24,12),end=now.getTime()/1000-3600;
  const items=[{id:'rev',kind:'revision',course_id:'c',week_number:null},{id:'weekly',kind:'revision',course_id:'c',week_number:2}];
  const base={course_id:'c',status:'finished',item_id:'rev',ended_at:end,focus_seconds:600};
  assert.equal(examFocusThisWeek([base,{...base,item_id:'weekly'},{...base,item_id:null},{...base,course_id:'other'},{...base,status:'paused'},{...base,ended_at:end-7*86400}],items,'c',now),600);
});
test('paper stats preserve zero scores and ungraded attempts',()=>{
  assert.deepEqual(attemptSummary([]),{count:0,best:null,minutes:0});
  assert.deepEqual(attemptSummary([{score:null,minutes:45},{score:0,minutes:30}]),{count:2,best:0,minutes:75});
});
test('exam navigation is derived from the course without task creation in calendar',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  const calendar=readFileSync(new URL('../components/tasks-planner.tsx',import.meta.url),'utf8');
  assert.match(page,/openCourse\(c.id,undefined,undefined,'exam'\)/);
  assert.match(calendar,/exams\.filter\(c=>c.exam_date===selectedDay\)/);
  assert.match(calendar,/!scheduled.length&&!due.length&&!dayExams.length/);
});
