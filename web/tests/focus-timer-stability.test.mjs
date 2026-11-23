import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  startFocusClock, recoverFocusClock, focusClockSeconds, focusClockDisplaySeconds, pauseFocusClock,
  resumeFocusClock, rekeyFocusClock, focusClockProgress,
} from '../lib/focus-timing.ts';

const serverRunning = {id:'server-1',started_at:1000,status:'running',accumulated_pause_seconds:0,
  pause_started_at:null,ended_at:null,focus_seconds:null,mode:'25'};

test('Start does not skip the first second regardless of wall-clock phase',()=>{
  const clock=startFocusClock('pending-1',1000_960,20_000);
  assert.equal(focusClockSeconds(clock,1001_020,20_060),0);
  assert.equal(focusClockSeconds(clock,1001_958,20_998),0);
  assert.equal(focusClockSeconds(clock,1001_960,21_000),1);
  assert.equal(focusClockSeconds(clock,1002_960,22_000),2);
});

test('Pause at 21 seconds freezes immediately and ignores delayed backend acknowledgement',()=>{
  const clock=startFocusClock('server-1',1_000_000,1_000);
  const paused=pauseFocusClock(clock,1_021_780,22_780);
  assert.equal(focusClockSeconds(paused,1_021_780,22_780),21);
  assert.equal(focusClockSeconds(paused,1_022_900,23_900),21);
  assert.equal(focusClockSeconds(paused,1_025_900,26_900),21);
  // Server returns a different whole-second start timestamp after a slow POST.
  const renamed=rekeyFocusClock(paused,'server-1');
  assert.equal(focusClockSeconds(renamed,1_030_000,31_000),21);
});

test('Resume starts a fresh full second, without an immediate +1 or a backward jump',()=>{
  const clock=startFocusClock('server-1',1_000_000,1_000);
  const paused=pauseFocusClock(clock,1_021_780,22_780);
  const resumed=resumeFocusClock(paused,1_050_760,50_760);
  assert.equal(focusClockSeconds(resumed,1_050_760,50_760),21);
  assert.equal(focusClockSeconds(resumed,1_051_759,51_759),21);
  assert.equal(focusClockSeconds(resumed,1_051_760,51_760),22);
  assert.equal(focusClockSeconds(resumed,1_052_760,52_760),23);
});

test('Countdown ring drains; Stopwatch has no cyclic progress; paused time stays frozen',()=>{
  const clock=startFocusClock('s',5_000,100);
  assert.equal(focusClockProgress(clock,'25',5_000,100),1);
  assert.equal(focusClockProgress(clock,'25',755_000,750_100),0.5);
  assert.equal(focusClockProgress(clock,'25',1_505_000,1_500_100),0);
  assert.equal(focusClockProgress(clock,'25',1_605_000,1_600_100),0);
  assert.equal(focusClockProgress(clock,'free',35_000,30_100),0);
  const paused=pauseFocusClock(clock,35_000,30_100);
  assert.equal(focusClockProgress(paused,'free',900_000,999_000),0);
});

test('Suspended computer catches up and clock correction backwards does not decrease duration',()=>{
  const clock=startFocusClock('s',100_000,5_000);
  assert.equal(focusClockSeconds(clock,130_000,8_000),30); // wall time covers sleep
  assert.equal(focusClockSeconds(clock,99_000,20_000),15); // monotonic time covers rollback
});

test('Existing paused sessions recover with a stable value',()=>{
  const recovered=recoverFocusClock({...serverRunning,status:'paused',pause_started_at:1021},1_090_000,90_000);
  assert.equal(focusClockSeconds(recovered,1_099_000,99_000),21);
});

test('Topbar and dial share one anchor; local API responses cannot rebase it',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  const clock=readFileSync(new URL('../components/focus-elapsed.tsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
  assert.match(page,/rekeyFocusClock\(previous,saved.id\)/);
  assert.match(page,/<FocusElapsed session=\{active\} anchor=\{focusClock\}\/>/);
  assert.match(page,/<FocusDial session=\{active\} anchor=\{focusClock\}\/>/);
  assert.match(clock,/focusClockProgress/);
  assert.match(clock,/useSyncExternalStore/);
  assert.match(clock,/const listeners = new Set/);
  assert.match(css,/\.timer-dial\.focus-dial-progress::before/);
  assert.match(clock,/focus-dial-stopwatch/);
  assert.match(css,/\.timer-dial\.focus-dial-stopwatch::before/);
  assert.match(css,/--focus-progress/);
});


test('Timed modes count down from the full target and never display negative time',()=>{
  const clock=startFocusClock('s',100_960,1_000);
  assert.equal(focusClockDisplaySeconds(clock,'25',100_960,1_000),1500);
  assert.equal(focusClockDisplaySeconds(clock,'50',100_960,1_000),3000);
  assert.equal(focusClockDisplaySeconds(clock,'90',100_960,1_000),5400);
  assert.equal(focusClockDisplaySeconds(clock,'50',101_959,1_999),3000);
  assert.equal(focusClockDisplaySeconds(clock,'50',101_960,2_000),2999);
  assert.equal(focusClockDisplaySeconds(clock,'50',3_100_960,3_001_000),0);
  assert.equal(focusClockDisplaySeconds(clock,'50',3_200_960,3_101_000),0);
  // Zero on screen does not cap the true elapsed time used by the backend.
  assert.equal(focusClockSeconds(clock,3_200_960,3_101_000),3100);
});

test('Count-up Stopwatch still starts at zero and never switches to a countdown',()=>{
  const clock=startFocusClock('s',100_960,1_000);
  assert.equal(focusClockDisplaySeconds(clock,'free',100_960,1_000),0);
  assert.equal(focusClockDisplaySeconds(clock,'free',121_960,22_000),21);
  assert.equal(focusClockDisplaySeconds(clock,'free',131_960,32_000),31);
});

test('Pausing a countdown freezes it, and resuming has no one-second jump',()=>{
  const clock=startFocusClock('s',1_000_000,1_000);
  const paused=pauseFocusClock(clock,1_021_780,22_780);
  assert.equal(focusClockDisplaySeconds(paused,'50',1_050_000,50_000),2979);
  assert.equal(focusClockProgress(paused,'25',1_050_000,50_000),1-21/1500);
  const resumed=resumeFocusClock(paused,1_050_760,50_760);
  assert.equal(focusClockDisplaySeconds(resumed,'50',1_051_759,51_759),2979);
  assert.equal(focusClockDisplaySeconds(resumed,'50',1_051_760,51_760),2978);
});

test('Header and circular Focus dial both use the same countdown function',()=>{
  const source=readFileSync(new URL('../components/focus-elapsed.tsx',import.meta.url),'utf8');
  assert.match(source,/duration\(focusClockDisplaySeconds\(clock, session\.mode, wallMs, monoMs\)\)/);
  assert.match(source,/const displaySeconds = focusClockDisplaySeconds\(clock, session\.mode, wallMs, monoMs\)/);
  assert.match(source,/duration\(displaySeconds\)/);
  assert.match(source,/targetReached/);
});
