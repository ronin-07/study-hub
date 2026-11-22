import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMutation } from '../lib/snapshot-cache.ts';

const makeSnapshot = () => ({
  courses:[{id:'course-1',title:'Initial'}], weeks:[],
  items:[{id:'item-1',title:'Read slides',done:false},{id:'item-2',title:'Revision',done:false}],
  resources:[],sessions:[],semesters:[]
});

test('a saved task updates only items, without resetting other collections', () => {
  const before=makeSnapshot();
  const updated=applyMutation(before,{collection:'items'},{...before.items[0],done:true});
  assert.equal(updated.items[0].done,true);
  assert.equal(updated.items[1],before.items[1]);
  assert.equal(updated.courses,before.courses);
  assert.equal(before.items[0].done,false);
});

test('new items append once; repeated patches are idempotent in the client cache', () => {
  const created=applyMutation(makeSnapshot(),{collection:'items'},{id:'new-task',title:'New task',done:false});
  const again=applyMutation(created,{collection:'items'},{id:'new-task',title:'Changed title',done:false});
  assert.equal(again.items.filter(i=>i.id==='new-task').length,1);
  assert.equal(again.items.find(i=>i.id==='new-task').title,'Changed title');
});

test('deletion leaves unrelated records intact, and no-change operations keep the cache', () => {
  const initial=makeSnapshot();
  const after=applyMutation(initial,{collection:'items',deleteId:'item-2'},undefined);
  assert.deepEqual(after.items.map(i=>i.id),['item-1']);
  assert.equal(after.courses,initial.courses);
  assert.equal(applyMutation(initial,{collection:'none'},undefined),initial);
});

test('a missing mutation result cannot silently corrupt the cache', () => {
  assert.throws(()=>applyMutation(makeSnapshot(),{collection:'resources'},undefined),/Unexpected response/);
});

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const api=readFileSync(new URL('../../backend/app/main.py',import.meta.url),'utf8');

test('checkboxes update optimistically, use a targeted task PATCH, and rollback on failure',()=>{
  assert.match(page,/pendingItemsRef\.current\.has\(item\.id\)/);
  assert.match(page,/items:previous\.items\.map\(i=>i\.id===item\.id\?\{\.\.\.i,done:!item\.done\}/);
  assert.match(page,/method:'PATCH',body:\{done:!item\.done\}/);
  assert.match(page,/items:previous\.items\.map\(i=>i\.id===item\.id\?item:i\)/);
});

test('only repeating completions fetch tasks to reconcile their successor',()=>{
  assert.match(page,/if\(!item\.done&&saved\.done&&saved\.repeat&&saved\.repeat!=='none'\)/);
  assert.match(page,/api<Item\[]>\('\/api\/items',user\)/);
  assert.match(api,/@app\.get\('\/api\/items'/);
});

test('the top-right noninteractive avatar is gone and sign-out is a real button',()=>{
  assert.doesNotMatch(page,/<span className="avatar"/);
  assert.match(page,/className="sidebar-signout" aria-label="Sign out of Study Hub"/);
  assert.match(page,/<LogOut size=\{15\}\/> Sign out/);
});

test('clock rerenders are limited when no focus timer is running',()=>{
  assert.match(page,/running\?1000:30000/);
  assert.match(page,/Date\.now\(\)-lastLoadedAtRef\.current>=30000/);
});

test('PDF bookmarks are debounced and serialized instead of blocking the global workspace',()=>{
  assert.match(page,/pdfBookmarkPendingRef/);
  assert.match(page,/setTimeout\(flushPdfBookmark,650\)/);
  assert.match(page,/pdfBookmarkWriteRef\.current=pdfBookmarkWriteRef\.current\.catch/);
  assert.match(page,/const closePdf=\(\)=>\{flushPdfBookmark\(\)/);
});
