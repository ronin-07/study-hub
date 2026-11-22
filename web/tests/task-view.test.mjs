import test from 'node:test';
import assert from 'node:assert/strict';
import { isActionable, belongsToToday, isOverdue, todayPriorities, upcomingWork, upcomingDeadlines, shiftCalendarMonth, focusTasksForContext } from '../lib/task-view.ts';

const today = '2026-11-22';
const task = (id, changes = {}) => ({
  id, title: id, planned_date: null, due_date: null, done: false, priority:'medium', ...changes
});

test('today includes due today and past planned work without deadlines', () => {
  const plannedYesterday = task('notes', { planned_date:'2026-11-21' });
  const dueToday = task('report', { due_date:today });
  const tomorrow = task('tomorrow', { planned_date:'2026-11-23' });
  const completed = task('finished', { due_date:'2026-11-20', done:true });
  assert.deepEqual(todayPriorities([plannedYesterday,dueToday,tomorrow,completed], today).map(i=>i.id), ['notes','report']);
  assert.equal(isOverdue(plannedYesterday,today),true);
  assert.equal(isOverdue(dueToday,today),false);
  assert.equal(belongsToToday(completed,today),false);
});

test('overdue takes priority, with higher priorities first within the same urgency', () => {
  const list = [task('normal',{due_date:today}),task('urgent',{due_date:'2026-11-19',priority:'high'}),task('late',{planned_date:'2026-11-21',priority:'low'})];
  assert.deepEqual(todayPriorities(list,today).map(i=>i.id), ['urgent','late','normal']);
});

test('upcoming work excludes today and overdue; upcoming deadlines exclude past due', () => {
  const list = [task('late',{due_date:'2026-11-20'}),task('due',{due_date:today}),task('future',{due_date:'2026-11-26'}),task('no-date')];
  assert.deepEqual(upcomingWork(list,today).map(i=>i.id),['future','no-date']);
  assert.deepEqual(upcomingDeadlines(list,today).map(i=>i.id),['due','future']);
});

test('calendar month shift updates selected day and clamps month end', () => {
  assert.equal(shiftCalendarMonth('2026-11-22',1),'2026-12-22');
  assert.equal(shiftCalendarMonth('2027-01-31',1),'2027-02-28');
  assert.equal(shiftCalendarMonth('2028-01-31',1),'2028-02-29');
  assert.equal(shiftCalendarMonth('2026-01-31',-1),'2025-12-31');
});


test('legacy due-only or planned weekly activities remain visible without migration', () => {
  assert.equal(isActionable(task('reading', {is_task:false, kind:'reading', due_date:'2026-11-22'})),true);
  assert.equal(isActionable(task('notes', {is_task:false, kind:'notes'})),false);
  assert.equal(isActionable(task('exam', {is_task:false, kind:'assignment'})),true);
});


test('personal and course-specific focus selectors keep linked task identity', () => {
  const personal = {...task('personal',{course_id:null}), is_task:true, kind:'personal'};
  const course = {...task('course',{course_id:'c2'}), is_task:true, kind:'revision'};
  const complete = {...task('finished',{course_id:null,done:true}), is_task:true, kind:'personal'};
  const unplannedNotes = {...task('unplanned',{course_id:'c2'}), is_task:false, kind:'notes'};
  assert.deepEqual(focusTasksForContext([personal,course,complete,unplannedNotes], '').map(t=>t.id), ['personal']);
  assert.deepEqual(focusTasksForContext([personal,course,complete,unplannedNotes], 'c2').map(t=>t.id), ['course']);
});
