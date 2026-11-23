import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayStudyCourses, nextSevenDays, nextDeadlineDays, agendaForDate } from '../lib/home-view.ts';
const item=(id,course_id,week_number,planned_date,due_date=null,done=false)=>({id,title:id,kind:'notes',course_id,week_number,planned_date,due_date,done,is_task:true,priority:'medium'});
const courses=[{id:'a',code:'02410',title:'First',week_count:13},{id:'b',code:'02516',title:'Second',week_count:13},{id:'c',code:'00000',title:'Archived',archived:true,week_count:13}];
test('groups actionable work by active course, excludes personal, future, archived and completed',()=>{
 const rows=[item('overdue','a',3,'2026-11-20'),item('today','a',5,'2026-11-22'),item('done','a',3,null,null,true),item('future','a',5,'2026-11-24'),item('due','b',null,null,'2026-11-22'),item('personal',null,null,'2026-11-22'),item('archived','c',1,'2026-11-22')];
 const groups=todayStudyCourses(courses,rows,'2026-11-22');
 assert.deepEqual(groups.map(g=>g.course.id),['a','b']);
 assert.deepEqual(groups[0].tasks.map(t=>t.id),['overdue','today']);
 assert.deepEqual(groups[0].weekNumbers,[3,5]);
 assert.equal(groups[0].overdueCount,1);
 assert.deepEqual([groups[0].doneCount,groups[0].activityCount],[0,1]); // Only today's planned item counts; not every activity in weeks 3 and 5
});
test('due-only item appears on home without a planned date',()=>{
 assert.deepEqual(todayStudyCourses(courses,[item('due','a',null,null,'2026-11-22')],'2026-11-22')[0].tasks.map(t=>t.id),['due']);
});
test('one course card for multiple teaching weeks, no duplicate scheduled items',()=>{
 const groups=todayStudyCourses(courses,[item('a','a',1,'2026-11-22','2026-11-22'),item('b','a',6,'2026-11-22')],'2026-11-22');
 assert.equal(groups.length,1); assert.equal(groups[0].tasks.length,2);
});
test('today progress spans weeks but counts only scheduled work, including completed items',()=>{
  const rows=[item('a','a',1,'2026-11-22'),item('b','a',4,'2026-11-22'),
    item('c','a',1,null),item('d','a',4,null)];
  const first=todayStudyCourses(courses,rows,'2026-11-22')[0];
  assert.deepEqual(first.weekNumbers,[1,4]);
  assert.deepEqual([first.todayCount,first.doneCount,first.activityCount],[2,0,2]);
  const after=todayStudyCourses(courses,rows.map(row=>row.id==='a'?{...row,done:true}:row),'2026-11-22')[0];
  assert.deepEqual([after.todayCount,after.doneCount,after.activityCount],[2,1,2]);
  const complete=todayStudyCourses(courses,rows.map(row=>(row.id==='a'||row.id==='b')?{...row,done:true}:row),'2026-11-22')[0];
  assert.deepEqual([complete.todayCount,complete.doneCount,complete.activityCount],[2,2,2]);
});
test('overdue-only course keeps catch-up work separate from today progress',()=>{
  const group=todayStudyCourses(courses,[item('old','a',4,'2026-11-20')],'2026-11-22')[0];
  assert.deepEqual([group.todayCount,group.doneCount,group.activityCount],[0,0,1]);
});
test('seven-day strip handles year-end and counts a task once if planned and due same day',()=>{
 const dates=nextSevenDays('2026-12-29',[item('same','a',1,'2027-01-01','2027-01-01')]);
 assert.equal(dates.length,7);assert.deepEqual(dates.map(x=>x.date),['2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04']);
 assert.equal(dates[3].count,1);
});
test('deadline days compare calendar dates without local timezone errors',()=>{
 assert.equal(nextDeadlineDays('2026-11-22','2026-11-25'),3);
 assert.equal(nextDeadlineDays('2026-12-31','2027-01-01'),1);
});

test('inline seven-day agenda deduplicates planned-and-due entries and skips completed items',()=>{
 const rows=[item('both','a',3,'2026-11-25','2026-11-25'),item('due','b',5,null,'2026-11-25'),item('done','a',3,'2026-11-25',null,true),item('tomorrow','a',1,'2026-11-26')];
 const agenda=agendaForDate(rows,'2026-11-25');
 assert.deepEqual(agenda.map(x=>x.item.id),['both','due']);
 assert.deepEqual(agenda.map(x=>x.reason),['planned-and-due','due']);
 assert.equal(agendaForDate(rows,'2026-11-24').length,0);
});
test('inline agenda sorts important tasks before medium and low',()=>{
 const rows=[item('low','a',1,'2026-11-25'),item('high','a',1,'2026-11-25'),item('medium','a',1,'2026-11-25')];
 rows[0].priority='low';rows[1].priority='high';
 assert.deepEqual(agendaForDate(rows,'2026-11-25').map(x=>x.item.id),['high','medium','low']);
});
