import test from 'node:test';
import assert from 'node:assert/strict';
import {examName,examYear,sortExamPapers,suggestedSolutions} from '../lib/exam-prep.ts';
const paper=(id,title,rest={})=>({id,title,kind:'exam_paper',course_id:'c',...rest});
test('exam titles and years infer from filenames and respect explicit edits',()=>{
 const p=paper('p','02450ex_Fall2017_corrected.pdf');assert.equal(examName(p),'Autumn 2017');assert.equal(examYear(p),2017);
 const renamed={...p,exam_display_name:'Mock exam 3',exam_year:2017};assert.equal(examName(renamed),'Mock exam 3');assert.equal(examYear(renamed),2017);assert.equal(examYear({...renamed,exam_year:null}),null);
});
test('all four sorts preserve unknown years last for chronological sorting',()=>{
 const p=[paper('b','Spring 2018.pdf'),paper('a','Fall2017.pdf'),paper('c','Mock exam.pdf')];
 assert.deepEqual(sortExamPapers(p,'year-desc').map(x=>x.id),['b','a','c']);assert.deepEqual(sortExamPapers(p,'year-asc').map(x=>x.id),['a','b','c']);assert.deepEqual(sortExamPapers(p,'name-asc').map(x=>x.id),['a','c','b']);assert.deepEqual(sortExamPapers(p,'name-desc').map(x=>x.id),['b','c','a']);
});
test('only same-course unpaired solutions are suggested and exact filename match first',()=>{
 const p=paper('p','02450ex_Fall2017_corrected.pdf');const sol=(id,title,rest={})=>({...paper(id,title,rest),kind:'exam_solution'});
 const candidates=suggestedSolutions(p,[sol('other','A.pdf'),sol('match','02450ex_Fall2017_corrected_sol.pdf'),sol('paired','02450ex_Fall2017_sol.pdf',{exam_paper_id:'x'}),sol('cross','02450ex_Fall2017_sol.pdf',{course_id:'other'})]);
 assert.deepEqual(candidates.map(x=>[x.resource.id,x.match]),[['match',true],['other',false]]);
});
