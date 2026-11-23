import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startFocusClock, pauseFocusClock, focusClockDisplaySeconds, focusClockProgress} from '../lib/focus-timing.ts';

const read = file=>readFileSync(new URL(`../${file}`, import.meta.url),'utf8');
const page=read('app/page.tsx');
const css=read('app/globals.css');
const dial=read('components/focus-elapsed.tsx');
const durationFields=read('components/focus-duration-fields.tsx');

test('open-ended stopwatch never cycles its ring progress at 60 seconds or an hour',()=>{
  const clock=startFocusClock('session',10_000,100);
  for(const seconds of [0,1,58,59,60,61,119,120,3599,3600,3601]) {
    assert.equal(focusClockProgress(clock,'free',10_000+1000*seconds,100+1000*seconds),0);
    assert.equal(focusClockDisplaySeconds(clock,'free',10_000+1000*seconds,100+1000*seconds),seconds);
  }
  const paused=pauseFocusClock(clock,71_000,61_100);
  assert.equal(focusClockDisplaySeconds(paused,'free',999_000,999_000),61);
  assert.match(dial,/focus-dial-stopwatch/);
  assert.match(dial,/stopwatch \? 0 : focusClockProgress/);
  assert.match(css,/\.timer-dial\.focus-dial-stopwatch::before/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('review duration fields have a single container-level focus ring with inset spacing',()=>{
  assert.match(durationFields,/type="number"/);
  assert.match(durationFields,/setFocusDurationPart\(total,part,e\.target\.value,maximum\)/);
  assert.match(css,/\.focus-duration-fields label:focus-within/);
  assert.match(css,/\.focus-duration-fields input:focus-visible/);
  assert.match(css,/input::-webkit-inner-spin-button/);
  assert.match(page,/className="focus-review-help"/);
  assert.match(css,/\.focus-review-help\{[^}]*margin:17px 2px 22px/);
});

test('Focus scales in larger cards but remains compact on mobile',()=>{
  assert.match(css,/\.focus-card\{container-type:inline-size/);
  assert.match(css,/@container focus-card \(min-width:540px\)/);
  assert.match(css,/\.focus-card \.timer-dial\{width:clamp/);
  assert.match(css,/@media\(max-width:810px\)/);
});

test('Resources keeps one focused search outline, a separately scrollable PDF list and sticky linking controls',()=>{
  assert.match(page,/className="resources-index-rows" role="region" tabIndex=\{0\}/);
  assert.match(page,/className="resources-link-help"/);
  assert.match(css,/\.resources-search input:focus-visible/);
  assert.match(css,/\.resources-index-rows\{\s*max-height:clamp/);
  assert.match(css,/\.resources-link-column\{position:sticky/);
  assert.match(css,/\.resources-link-help\{/);
  assert.match(page,/selectedPdfId===f\.id/);
  assert.match(page,/linkDriveFile\(selectedPdf\)/);
});

test('sidebar labels, task badge and breadcrumb use Study Hub terminology',()=>{
  assert.match(page,/STUDY HUB <span>\/</);
  assert.doesNotMatch(page,/> PERSONAL HUB </);
  assert.match(page,/courses:'Study'/);
  assert.match(page,/library:'Resources'/);
  assert.match(page,/incomplete tasks/);
  assert.match(page,/sidebarCollapsed\?'Expand sidebar':'Collapse sidebar'/);
  assert.match(page,/<ProfileName name=\{profileName\}\/>/);
  assert.match(css,/\.sidebar-profile-tooltip/);
});
