import test from 'node:test';
import assert from 'node:assert/strict';
import {examName,examYear,examSortOptions,filterExamPapers,practiceFocusMode,sortExamPapers,suggestedSolutions} from '../lib/exam-prep.ts';
import {checklistPercent,reachedMilestone} from '../lib/progress-presentation.ts';
import {focusClockDisplaySeconds,startFocusClock} from '../lib/focus-timing.ts';
const paper=(id,title,rest={})=>({id,title,kind:'exam_paper',course_id:'c',...rest});
test('exam titles and years infer from filenames and respect explicit edits',()=>{
 const p=paper('p','02450ex_Fall2017_corrected.pdf');assert.equal(examName(p),'Autumn 2017');assert.equal(examYear(p),2017);
 const renamed={...p,exam_display_name:'Mock exam 3',exam_year:2017};assert.equal(examName(renamed),'Mock exam 3');assert.equal(examYear(renamed),2017);assert.equal(examYear({...renamed,exam_year:null}),null);
});
test('chronological sorting reverses seasons and leaves undated papers last',()=>{
 const p=[paper('b','Spring 2018.pdf'),paper('a','Fall2017.pdf'),paper('c','Mock exam.pdf'),
   paper('d','Spring2017.pdf',{exam_display_name:'Renamed mock',exam_year:2017}),
   paper('e','2017 practice.pdf'),paper('f','Winter2017.pdf'),paper('g','Summer2017.pdf')];
 assert.deepEqual(examSortOptions.map(option=>option.value),['year-desc','year-asc']);
 assert.deepEqual(sortExamPapers(p,'year-desc').map(x=>x.id),['b','a','g','d','f','e','c']);
 assert.deepEqual(sortExamPapers(p,'year-asc').map(x=>x.id),['f','d','g','a','e','b','c']);
});
test('only same-course unpaired solutions are suggested and exact filename match first',()=>{
 const p=paper('p','02450ex_Fall2017_corrected.pdf');const sol=(id,title,rest={})=>({...paper(id,title,rest),kind:'exam_solution'});
 const candidates=suggestedSolutions(p,[sol('other','A.pdf'),sol('match','02450ex_Fall2017_corrected_sol.pdf'),sol('paired','02450ex_Fall2017_sol.pdf',{exam_paper_id:'x'}),sol('cross','02450ex_Fall2017_sol.pdf',{course_id:'other'})]);
 assert.deepEqual(candidates.map(x=>[x.resource.id,x.match]),[['match',true],['other',false]]);
});

test('search combines display name, year and filename with attempt and missing-solution filters',()=>{
 const papers=[paper('a','Fall2017.pdf',{exam_display_name:'Mock',exam_year:2017,exam_attempts:[{score:0}]}),
   paper('b','Spring2017.pdf'),paper('c','Mock 2024.pdf')];
 const paired=new Set(['a']);
 assert.deepEqual(filterExamPapers(papers,' 2017 MoCK ','attempted',false,paired).map(p=>p.id),['a']);
 assert.deepEqual(filterExamPapers(papers,'fall','all',false,paired).map(p=>p.id),['a']);
 assert.deepEqual(filterExamPapers(papers,'2017','unattempted',true,paired).map(p=>p.id),['b']);
 assert.deepEqual(filterExamPapers(papers,'2017','attempted',true,paired),[]);
});

test('a nonempty checklist must be fully complete even when the percentage would round up',()=>{
 assert.equal(checklistPercent(0,0),0);
 assert.equal(checklistPercent(299,300),99);
 assert.equal(reachedMilestone(98,checklistPercent(299,300)),false);
 assert.equal(reachedMilestone(99,checklistPercent(300,300)),true);
 assert.equal(reachedMilestone(100,checklistPercent(300,300)),false);
});

test('practice time uses the normal countdown and stopwatch clock',()=>{
 const clock=startFocusClock('practice',1_000_000,1000);
 const countdown=practiceFocusMode('countdown','137');
 assert.equal(countdown,'137');
 assert.equal(focusClockDisplaySeconds(clock,countdown,1_060_000,61_000),137*60-60);
 assert.equal(focusClockDisplaySeconds(clock,practiceFocusMode('stopwatch',''),1_060_000,61_000),60);
 for(const invalid of ['', '0','721','3.5','hello'])assert.equal(practiceFocusMode('countdown',invalid),null);
});
