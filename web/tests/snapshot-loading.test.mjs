import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchSnapshotWithRetry, canRetrySnapshot, describeSnapshotFailure} from '../lib/snapshot-loading.ts';

const http=(status)=>Object.assign(new Error('HTTP error'),{status,requestId:'preview-123'});
test('first load retries one transient 503 response then returns the real snapshot',async()=>{
  let count=0;
  const result=await fetchSnapshotWithRetry(async()=>{if(++count===1)throw http(503);return {courses:[{id:'a'}]};},async()=>{});
  assert.deepEqual(result,{courses:[{id:'a'}]});assert.equal(count,2);
});
test('auth failures do not retry and explain what the user can fix',async()=>{
  for(const status of [401,403]){
    let attempts=0;
    await assert.rejects(fetchSnapshotWithRetry(async()=>{attempts++;throw http(status);},async()=>{}));
    assert.equal(attempts,1);
    assert.match(describeSnapshotFailure(http(status)).diagnostics,new RegExp(`HTTP ${status}`));
  }
});
test('persistent transient errors stop after one bounded retry',async()=>{
  let count=0;
  await assert.rejects(fetchSnapshotWithRetry(async()=>{count++;throw http(503);},async()=>{}));
  assert.equal(count,2);
});
test('network/timeout can retry but schema parsing does not',()=>{
  assert.equal(canRetrySnapshot(new TypeError('Failed to fetch')),true);
  assert.equal(canRetrySnapshot(Object.assign(new Error('abort'),{name:'AbortError'})),true);
  assert.equal(canRetrySnapshot(new SyntaxError('bad JSON')),false);
});
test('loading errors contain safe, actionable diagnostics without sensitive server text',()=>{
  const error=Object.assign(new Error('Bearer secret-value'),{status:500,requestId:'preview-123'});
  const issue=describeSnapshotFailure(error);
  assert.match(issue.description,/Preview API/);
  assert.match(issue.diagnostics,/HTTP 500/);
  assert.doesNotMatch(JSON.stringify(issue),/secret-value/);
});
