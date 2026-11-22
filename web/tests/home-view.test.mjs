import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayStudyCourses, nextSevenDays, nextDeadlineDays } from '../lib/home-view.ts';
const item=(id,course_id,week_number,planned_date,due_date=null,done=false)=>({id,title:id,kind:'notes',course_id,week_number,planned_date,due_date,done,is_task:true,priority:'medium'});
const courses=[{id:'a',code:'02410',title:'First',week_count:13},{id:'b',code:'02516',title:'Second',week_count:13},{id:'c',code:'00000',title:'Archived',archived:true,week_count:13}];
test('groups actionable work by active course, excludes personal, future, archived and completed',()=>{
 const rows=[item('overdue','a',3,'2026-11-20'),item('today','a',5,'2026-11-22'),item('done','a',3,null,null,true),item('future','a',5,'2026-11-24'),item('due','b',null,null,'2026-11-22'),item('personal',null,null,'2026-11-22'),item('archived','c',1,'2026-11-22')];
 const groups=todayStudyCourses(courses,rows,'2026-11-22');
 assert.deepEqual(groups.map(g=>g.course.id),['a','b']);
 assert.deepEqual(groups[0].tasks.map(t=>t.id),['overdue','today']);
 assert.deepEqual(groups[0].weekNumbers,[3,5]);
 assert.equal(groups[0].overdueCount,1);
 assert.deepEqual([groups[0].doneCount,groups[0].activityCount],[1,4]);
});
test('due-only item appears on home without a planned date',()=>{
 assert.deepEqual(todayStudyCourses(courses,[item('due','a',null,null,'2026-11-22')],'2026-11-22')[0].tasks.map(t=>t.id),['due']);
});
test('one course card for multiple teaching weeks, no duplicate scheduled items',()=>{
 const groups=todayStudyCourses(courses,[item('a','a',1,'2026-11-22','2026-11-22'),item('b','a',6,'2026-11-22')],'2026-11-22');
 assert.equal(groups.length,1); assert.equal(groups[0].tasks.length,2);
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
