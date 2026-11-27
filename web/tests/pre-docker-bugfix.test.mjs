import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {changeClockPart,formatLocalClock} from '../lib/clock.ts';
import {attachBulkActivity,bulkDrafts,moveBulkWeek,selectBulkActivity,validBulkRow} from '../lib/bulk-resources.ts';
import {courseAcronym,filenameCourse,filenameWeek,fileSuggestion} from '../lib/filename-matching.ts';

const cv={id:'cv',code:'02516',title:'Introduction to Deep Learning in Computer Vision',week_count:13};
const ml={id:'ml',code:'02450',title:'Introduction to Machine Learning',week_count:13};
const item=(id,week,title='Lecture slides',course_id='cv')=>({id,course_id,week_number:week,title});
const data={courses:[cv,ml],weeks:[],resources:[],items:[item('l1',1),item('l5',5),item('l6',6),item('b5',5,'Book reading'),item('b6',6,'Book reading'),item('dup1',9),item('dup2',9),item('ml8',8,'Lecture slides','ml')]};
const file=name=>({id:name,name,mimeType:'application/pdf'});
const draft=()=>bulkDrafts([file('IDLCV_L1.pdf')],data,'ml',()=> 'row')[0];

test('24-hour clock handles midnight, noon and late evening in local time',()=>{
  for(const [h,m,expected] of [[0,0,'00:00'],[12,0,'12:00'],[23,59,'23:59']])assert.equal(formatLocalClock(new Date(2026,10,27,h,m).getTime()),expected);
});
test('optional time selector initializes, edits, clears and rejects invalid parts',()=>{
  assert.equal(changeClockPart('','hour','00'),'00:00');
  assert.equal(changeClockPart('','minute','35'),'00:35');
  assert.equal(changeClockPart('09:00','hour','21'),'21:00');
  assert.equal(changeClockPart('21:00','minute','45'),'21:45');
  assert.equal(changeClockPart('21:45','minute',''),'');
  assert.equal(changeClockPart('21:45','hour','24'),'21:45');
  assert.equal(changeClockPart('21:45','minute','60'),'21:45');
});
test('course editor uses accessible locale-independent controls instead of native time input',()=>{
  const course=readFileSync(new URL('../components/course-planner.tsx',import.meta.url),'utf8');
  const input=readFileSync(new URL('../components/time-input-24.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(course,/type="time"/);assert.match(course,/<TimeInput24 value=\{courseDraft.exam_time\}/);
  assert.match(input,/options\(24\),minutes=options\(60\)/);assert.match(input,/aria-label="Clear exam start time"/);assert.match(course,/exam_time:courseDraft.exam_time\|\|null/);
});
test('bulk apply remembers title and maps each destination to its own activity ID',()=>{
  const row=attachBulkActivity(draft(),'Lecture slides',data);
  assert.equal(row.item_id,'l1');
  const moved=moveBulkWeek(row,5,data);assert.equal(moved.item_id,'l5');assert.equal(moved.expectedActivity,'Lecture slides');
  assert.equal(moveBulkWeek(moved,6,data).item_id,'l6');assert.ok(validBulkRow(moved,[moved],data));
});
test('missing or duplicate activity falls back, retains intent and restores when available',()=>{
  const row=attachBulkActivity(draft(),'Lecture slides',data);
  for(const week of [8,9]){const moved=moveBulkWeek(row,week,data);assert.equal(moved.item_id,'');assert.equal(moved.expectedActivity,'Lecture slides');assert.equal(moveBulkWeek(moved,6,data).item_id,'l6');}
});
test('manual selection overrides common activity, explicit entire week and course library clear intent',()=>{
  const row=moveBulkWeek(attachBulkActivity(draft(),'Lecture slides',data),5,data);
  const manual=selectBulkActivity(row,'b5',data);assert.equal(moveBulkWeek(manual,6,data).item_id,'b6');
  for(const cleared of [selectBulkActivity(manual,'',data),moveBulkWeek(manual,null,data)]){assert.equal(cleared.expectedActivity,undefined);assert.equal(moveBulkWeek(cleared,6,data).item_id,'');}
  assert.equal(selectBulkActivity(row,'ml8',data).item_id,'');
});
test('bulk UI uses the tested helpers for apply, location and manual activity selection',()=>{
  const source=readFileSync(new URL('../components/bulk-resource-linker.tsx',import.meta.url),'utf8');
  assert.match(source,/attachBulkActivity\(r,commonActivity,data\)/);assert.match(source,/moveBulkWeek\(r,/);assert.match(source,/selectBulkActivity\(r,e.target.value,data\)/);assert.match(source,/r.expectedActivity&&!r.item_id/);assert.match(source,/Keep entire week/);
});
test('recognizes lecture/week shorthand and ignores conflicting or embedded tokens',()=>{
  for(const [name,week] of [['IDLCV_L5_VideoClassification.pdf',5],['IDLCV_L06.pdf',6],['IDLCV_L_7_MortalSins.pdf',7],['W05.pdf',5],['Week_5.pdf',5],['Lecture-5.pdf',5],['Lec.05.pdf',5]])assert.equal(filenameWeek(name),week,name);
  for(const name of ['modelL5.pdf','L5abc.pdf','L00.pdf','Week5_L6.pdf','W2026.pdf'])assert.equal(filenameWeek(name),null,name);
});
test('course title acronym matches only unique active courses; explicit codes take precedence',()=>{
  assert.equal(courseAcronym(cv.title),'idlcv');assert.equal(filenameCourse('IDLCV_L5.pdf',data.courses)?.id,'cv');
  const collision={...cv,id:'other',code:'00001'};
  assert.equal(filenameCourse('IDLCV_L5.pdf',[cv,collision]),undefined);
  assert.equal(filenameCourse('02516_IDLCV_L5.pdf',[cv,collision])?.id,'cv');
  assert.equal(filenameCourse('IDLCV_L5.pdf',[cv,{...collision,archived:true}])?.id,'cv');
  assert.equal(filenameCourse('notIDLCV_L5.pdf',data.courses),undefined);
});
test('bulk and single suggestions recognize the course despite a different initial selection',()=>{
  const row=bulkDrafts([file('IDLCV_L5_VideoClassification.pdf')],data,'ml',()=> 'row')[0];
  assert.deepEqual([row.course_id,row.week_number,row.kind,row.suggested],['cv',5,'slides',true]);
  const suggestion=fileSuggestion(file('IDLCV_L6.pdf'),data);assert.equal(suggestion.course_id,'cv');assert.equal(suggestion.week_number,6);assert.equal(suggestion.kind,'slides');
  assert.equal(fileSuggestion(file('IDLCV_L14.pdf'),data),null);
  const invalid=bulkDrafts([file('IDLCV_L14.pdf')],data,'ml',()=> 'row')[0];assert.equal(validBulkRow(invalid,[invalid],data),false);
});
