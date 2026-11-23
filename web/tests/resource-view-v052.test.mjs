import test from 'node:test';
import assert from 'node:assert/strict';
import { filterIndexedPdfs } from '../lib/resource-view.ts';

const file = (id,name,path,suggestion=null,links=[])=>({id,name,path,suggestion,links,mimeType:'application/pdf'});
const resources = [
  file('a','lecture1.pdf','ML/Slides', {course_id:'ml',course_code:'02452',week_number:1,kind:'slides',confidence:'high',reason:'name'}),
  file('b','lecture1.pdf','DL/Slides'),
  file('c','notes.pdf','ML/Week 5',null,[{resource_id:'r',course_id:'ml',week_number:5}]),
];

test('resource filter respects linked and suggested semantics without renaming files',()=>{
  assert.deepEqual(filterIndexedPdfs(resources,'unlinked','').map(x=>x.id),['a','b']);
  assert.deepEqual(filterIndexedPdfs(resources,'suggested','').map(x=>x.id),['a']);
  assert.deepEqual(filterIndexedPdfs(resources,'linked','').map(x=>x.id),['c']);
  assert.deepEqual(filterIndexedPdfs(resources,'all','').map(x=>x.id),['a','b','c']);
});
test('resource search filters within status using filename and folder, not deduplicated names',()=>{
  assert.deepEqual(filterIndexedPdfs(resources,'unlinked','lecture1').map(x=>x.id),['a','b']);
  assert.deepEqual(filterIndexedPdfs(resources,'all','dl/').map(x=>x.id),['b']);
  assert.deepEqual(filterIndexedPdfs(resources,'linked','notes').map(x=>x.id),['c']);
});
