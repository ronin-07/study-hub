import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewPause, previewResume, currentFocusSeconds, sessionReviewLimit} from '../lib/focus-timing.ts';

const running = {id:'s1',started_at:1000,status:'running',accumulated_pause_seconds:0,
  pause_started_at:null,ended_at:null,focus_seconds:null,mode:'free'};

test('end review freezes the shown duration at the click rather than counting response latency',()=>{
  assert.equal(sessionReviewLimit(running,1009_900),9);
  const paused=previewPause(running,1009);
  assert.equal(paused.status,'paused');
  assert.equal(currentFocusSeconds(paused,1012_000),9);
  assert.equal(currentFocusSeconds(paused,1040_000),9);
  assert.equal(running.status,'running');
});

test('resuming excludes time spent paused',()=>{
  const paused=previewPause(running,1010);
  const resumed=previewResume(paused,1050);
  assert.equal(resumed.accumulated_pause_seconds,40);
  assert.equal(currentFocusSeconds(resumed,1060_000),20);
});

test('elapsed time uses wall clock after a background-tab delay',()=>{
  assert.equal(currentFocusSeconds(running,1010_000),10);
  assert.equal(currentFocusSeconds(running,1300_000),300);
  assert.equal(sessionReviewLimit(running,99_999_000),86400);
});

test('Focus clock is isolated from the page render and stopping immediately pauses for review',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  const component=readFileSync(new URL('../components/focus-elapsed.tsx',import.meta.url),'utf8');
  assert.match(page,/const active=focusPreview\?\?/);
  assert.match(page,/setFinishReview\(true\)/);
  assert.match(page,/focusRequest\(previewPause\(active/);
  assert.match(page,/displayed_seconds:seconds/);
  assert.match(page,/<FocusElapsed session=\{active\}/);
  assert.doesNotMatch(page,/running\?1000:30000/);
  assert.match(component,/memo\(function FocusElapsed/);
  assert.match(component,/setInterval\(refresh, 250\)/);
});
