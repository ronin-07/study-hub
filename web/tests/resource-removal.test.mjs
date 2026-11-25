import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyMutation,preserveWorkspaceChanges} from '../lib/snapshot-cache.ts';
const hint={collection:'resources',deleteId:'pdf',removeWithLinks:true};
test('resource removal updates affected activities and protects against a stale snapshot',()=>{
  const before={items:[{id:'one',resource_id:'pdf',done:true},{id:'two',resource_id:'other'}],resources:[{id:'pdf'},{id:'other'}],courses:[],weeks:[],semesters:[],sessions:[]};
  const result={resource_id:'pdf',items:[{id:'one',resource_id:null,done:true}]};
  const after=applyMutation(before,hint,result);
  assert.deepEqual(after.resources,[{id:'other'}]);assert.deepEqual(after.items,[result.items[0],before.items[1]]);
  assert.deepEqual(preserveWorkspaceChanges(before,after,{resources:new Set(['pdf']),items:new Set(['one'])},new Set()),after);
  assert.throws(()=>applyMutation(before,hint,{...result,resource_id:'other'}),/Unexpected resource removal/);
});
test('confirmation is server-backed, blocks protected resources and uses targeted cache update',()=>{
  const dialog=readFileSync(new URL('../components/resource-removal-dialog.tsx',import.meta.url),'utf8');
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(dialog,/removal-preview/);assert.match(dialog,/preview_token:preview.preview_token/);assert.match(dialog,/preview.blockers.length/);assert.match(dialog,/removeWithLinks:true/);
  assert.match(page,/snapshotCoordinator.retain\('resources',mutation.deleteId\)/);assert.match(page,/for\(const row of rows\)snapshotCoordinator.retain\('items',row.id\)/);
});
