import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activityResources,isExamResource,pairedSolutions} from '../lib/resource-links.ts';
import {bulkDrafts,validBulkRow} from '../lib/bulk-resources.ts';
import {applyMutation,preserveWorkspaceChanges} from '../lib/snapshot-cache.ts';
const activity={id:'item',course_id:'course',week_number:1,resource_id:'both',done:true};
const resources=[{id:'both',course_id:'course',week_number:1,item_id:'item',kind:'slides'},{id:'reverse',course_id:'course',week_number:1,item_id:'item',kind:'annotated'},{id:'cross',course_id:'other',week_number:1,item_id:'item'},{id:'wrong-week',course_id:'course',week_number:2,item_id:'item'}];
test('activity displays both legacy reference and multiple weekly attachments once',()=>assert.deepEqual(activityResources(activity,resources).map(r=>r.id),['both','reverse']));
test('detach reconciles both records and protects cache from stale snapshot',()=>{
 const before={items:[activity],resources,courses:[],weeks:[],semesters:[],sessions:[]};
 const result={resource:{...resources[0],item_id:null},items:[{...activity,resource_id:null}]};
 const after=applyMutation(before,{collection:'resources',detachLinks:true},result);
 assert.deepEqual(activityResources(after.items[0],after.resources).map(r=>r.id),['reverse']);
 assert.deepEqual(preserveWorkspaceChanges(before,after,{items:new Set(['item']),resources:new Set(['both'])},new Set()),after);
});
test('exam grouping uses same course and explicit pair',()=>{
 const paper={id:'paper',course_id:'course',kind:'exam_paper'};
 const sols=[{id:'solution',kind:'exam_solution',course_id:'course',exam_paper_id:'paper'},{id:'other',kind:'exam_solution',course_id:'other',exam_paper_id:'paper'},{id:'unpaired',kind:'exam_solution',course_id:'course'}];
 assert.deepEqual(pairedSolutions(paper,sols),[sols[0]]);assert.ok(isExamResource('exam_solution'));assert.ok(!isExamResource('slides'));
});
test('bulk filename week suggestions and pairing require reviewed valid destinations',()=>{
 const files=['02452_lecture11_fall26.pdf','Exam_Fall2017.pdf','Exam_Fall2017_corrected_sol.pdf'].map((name,i)=>({id:'file'+i,name,mimeType:'application/pdf'}));
 const data={courses:[{id:'course',week_count:13}],resources:[],items:[activity]};let n=0;
 const rows=bulkDrafts(files,data,'course',()=>String(++n));assert.equal(rows[0].week_number,11);assert.equal(rows[1].kind,'exam_paper');assert.equal(rows[2].exam_paper_id,rows[1].id);assert.ok(rows.every(r=>validBulkRow(r,rows,data)));
 assert.ok(!validBulkRow(rows[2],[rows[2]],data));assert.ok(!validBulkRow({...rows[0],item_id:'item'},rows,data));
});
test('removal and resource views reuse existing records, and exam-only resources are filtered',()=>{
 const study=readFileSync(new URL('../components/course-planner.tsx',import.meta.url),'utf8');
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(study,/allShared\.filter\(r=>!isExamResource\(r.kind\)\)/);assert.match(study,/\/detach/);assert.match(study,/compact-activity/);assert.match(page,/detachLinks/);assert.match(page,/BulkResourceLinker/);
});
test('older DTU filename conventions pair after review, and out-of-range weeks are not silently reassigned',()=>{
 const files=['02450ex_Fall2017.pdf','02450ex_Fall2017_corrected_sol.pdf','02452_lecture14_fall26.pdf'].map((name,i)=>({id:'f'+i,name,mimeType:'application/pdf'}));
 const data={courses:[{id:'course',week_count:13}],resources:[],items:[]};let n=0;
 const rows=bulkDrafts(files,data,'course',()=>String(++n));assert.equal(rows[0].kind,'exam_paper');assert.equal(rows[1].exam_paper_id,rows[0].id);assert.equal(rows[2].week_number,14);assert.equal(validBulkRow(rows[2],rows,data),false);
});
