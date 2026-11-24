import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMutation, preserveWorkspaceChanges } from '../lib/snapshot-cache.ts';

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

test('an older snapshot preserves local updates, additions and deletions while merging other records',()=>{
  const incoming=makeSnapshot();
  incoming.items.push({id:'remote',title:'Added from another device',done:false});
  incoming.courses.push({id:'course-2',title:'Remote course'});
  let current=makeSnapshot();
  current=applyMutation(current,{collection:'items'},{...current.items[0],done:true});
  current=applyMutation(current,{collection:'items',deleteId:'item-2'},undefined);
  current=applyMutation(current,{collection:'items'},{id:'local',title:'Locally saved',done:false});
  const merged=preserveWorkspaceChanges(incoming,current,{items:new Set(['item-1','item-2','local'])},new Set());
  assert.deepEqual(merged.items.map(i=>i.id),['item-1','remote','local']);
  assert.equal(merged.items[0].done,true);
  assert.equal(merged.items[1],incoming.items[2]);
  assert.equal(merged.courses,incoming.courses);
});

test('pending checkboxes and a newer recurring-items refresh survive a snapshot',()=>{
  const incoming=makeSnapshot();
  let current=makeSnapshot();
  current=applyMutation(current,{collection:'items'},{...current.items[0],done:true});
  assert.equal(preserveWorkspaceChanges(incoming,current,{},new Set(['item-1'])).items[0].done,true);
  current=applyMutation(current,{collection:'items'},{id:'next-occurrence',title:'Weekly review',done:false});
  assert.equal(preserveWorkspaceChanges(incoming,current,{items:'all'},new Set()).items,current.items);
});

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const api=readFileSync(new URL('../../backend/app/main.py',import.meta.url),'utf8');

test('checkboxes update optimistically, use a targeted task PATCH, and rollback on failure',()=>{
  assert.match(page,/pendingItemsRef\.current\.has\(item\.id\)/);
  assert.match(page,/items:previous\.items\.map\(i=>i\.id===item\.id\?\{\.\.\.i,done:!item\.done\}/);
  assert.match(page,/method:'PATCH',body:\{done:!item\.done\}/);
  assert.match(page,/items:previous\.items\.map\(i=>i\.id===item\.id\?\{\.\.\.i,done:item\.done\}:i\)/);
});

test('completion reconciles the affected records without a full item list',()=>{
  assert.match(page,/\/api\/items\/\$\{item.id\}\/with-successor/);
  assert.match(page,/response.successor/);
  assert.ok(api.includes("@app.patch('/api/items/{identifier}/with-successor'"));
});

test('the top-right noninteractive avatar is gone and sign-out is a real button',()=>{
  assert.doesNotMatch(page,/<span className="avatar"/);
  assert.match(page,/className="sidebar-signout"[^>]*aria-label="Sign out of Study Hub"/);
  assert.match(page,/<LogOut size=\{15\}\/><span className="sidebar-signout-label">Sign out<\/span>/);
});

test('clock rerenders are limited when no focus timer is running',()=>{
  assert.match(page,/setInterval\(refresh,30000\)/);
  assert.match(page,/<FocusElapsed session=\{active\} anchor=\{focusClock\}\/>/);
  assert.match(page,/Date\.now\(\)-lastLoadedAtRef\.current>=30\*60\*1000/);
});

test('PDF bookmarks are debounced and serialized instead of blocking the global workspace',()=>{
  assert.match(page,/pdfBookmarkPendingRef/);
  assert.match(page,/setTimeout\(flushPdfBookmark,650\)/);
  assert.match(page,/pdfBookmarkWriteRef\.current=pdfBookmarkWriteRef\.current\.catch/);
  assert.match(page,/const closePdf=\(\)=>\{/);
  assert.match(page,/const closePdf=[\s\S]*?flushPdfBookmark\(\)/);
});
