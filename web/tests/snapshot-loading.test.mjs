import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotCoordinator, fetchSnapshotWithRetry, canRetrySnapshot, describeSnapshotFailure} from '../lib/snapshot-loading.ts';
import {api} from '../lib/api.ts';

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

test('overlapping reads for one account and week make one request',async()=>{
  const coordinator=createSnapshotCoordinator();
  let calls=0;
  const read=async()=>{calls++;return true;};
  const first=coordinator.run('account:week',read);
  const second=coordinator.run('account:week',read);
  assert.equal(second,first);
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(calls,1);
  await coordinator.run('account:week',read);
  assert.equal(calls,2);
});

test('a post-save read cancels the older read and receives subsequent refreshes',async()=>{
  const coordinator=createSnapshotCoordinator();
  let priorSignal;
  const first=coordinator.run('account:week',async signal=>{
    priorSignal=signal;
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    return false;
  });
  await Promise.resolve();
  const afterSave=coordinator.run('account:week',async()=>true,true);
  assert.equal(priorSignal.aborted,true);
  assert.equal(coordinator.run('account:week',async()=>assert.fail('duplicate request')),afterSave);
  assert.deepEqual(await Promise.all([first,afterSave]),[false,true]);
});

test('account and week changes cancel obsolete reads and clear their local changes',async()=>{
  const coordinator=createSnapshotCoordinator();
  const first=coordinator.run('first:week',async()=>assert.fail('canceled request had not started'));
  coordinator.retain('items','prior-item');
  const second=coordinator.run('second:week',async(_signal,changes)=>{
    assert.deepEqual(changes,{});
    return true;
  });
  assert.deepEqual(await Promise.all([first,second]),[false,true]);
  const previousWeek=coordinator.run('second:week',async()=>assert.fail('old week requested'));
  const nextWeek=coordinator.run('second:next-week',async()=>true);
  assert.deepEqual(await Promise.all([previousWeek,nextWeek]),[false,true]);
  const beforeSignOut=coordinator.run('second:next-week',async()=>assert.fail('signed out'));
  coordinator.cancel();
  assert.equal(await beforeSignOut,false);
});

test('a snapshot tracks local changes only until its read settles',async()=>{
  const coordinator=createSnapshotCoordinator();
  const first=coordinator.run('account:week',async(_signal,changes)=>{
    assert.deepEqual(changes,{items:new Set(['updated']),resources:new Set(['removed'])});
    return true;
  });
  coordinator.retain('items','updated');
  coordinator.retain('resources','removed');
  await first;
  await coordinator.run('account:week',async(_signal,changes)=>{
    assert.deepEqual(changes,{});
    return true;
  });
});

test('aborting during retry backoff does not send a second request',async()=>{
  const controller=new AbortController();
  let attempts=0;
  await assert.rejects(fetchSnapshotWithRetry(
    async()=>{attempts++;throw http(503);},
    async()=>controller.abort(),
    controller.signal,
  ),{name:'AbortError'});
  assert.equal(attempts,1);
});

test('superseded API reads can still be aborted while reading the response body',async t=>{
  const controller=new AbortController();
  let started;
  const bodyStarted=new Promise(resolve=>{started=resolve;});
  t.mock.method(globalThis,'fetch',async(_route,{signal})=>({
    ok:true,status:200,
    json(){
      const body=new Promise((_resolve,reject)=>{
        signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
      });
      started();
      return body;
    },
  }));
  const reading=api('/api/snapshot',null,{timeoutMs:15000,signal:controller.signal});
  const rejected=assert.rejects(reading,{name:'AbortError'});
  await bodyStarted;
  controller.abort();
  await rejected;
});
