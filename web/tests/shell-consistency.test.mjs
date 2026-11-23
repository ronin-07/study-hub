import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

test('the account footer is identical on Home and every other tab',()=>{
  assert.match(page,/<div className="sidebar-bottom">/);
  assert.match(page,/className="sidebar-profile"/);
  assert.match(page,/className="sidebar-footer-row"/);
  assert.match(page,/<aside className=\{'sidebar'\+\(sidebarCollapsed\?/);
  assert.match(page,/<small>DTU<\/small>/);
  assert.doesNotMatch(page,/RepLap stays in its own project/);
  assert.doesNotMatch(page,/tab==='today'\?<div className="sidebar-profile"/);
  assert.match(page,/Sign out of Study Hub/);
});

test('date and clock are beside each other and share all tabs',()=>{
  assert.match(page,/className="topbar-datetime"/);
  assert.match(page,/className="topbar-date-section"/);
  assert.match(page,/dateLabel/);
  assert.match(page,/const timeLabel=clockReady\?formatLocalClock/);
  assert.match(page,/setClockReady\(true\)/);
  assert.match(css,/\.dashboard-topbar \.topbar-clock/);
  assert.match(css,/\.topbar-clock\{/);
});

test('Quick Focus is in the shared top bar and never duplicated as a Home widget',()=>{
  assert.match(page,/className="topbar-focus-wrap"/);
  assert.match(page,/className="topbar-quick-focus"/);
  assert.match(page,/className="topbar-focus-session"/);
  assert.match(page,/Start a focus session/);
  assert.match(page,/onClick=\{\(\)=>void startQuickFocus\(\)\}/);
  assert.match(page,/id="active-focus-menu"/);
  assert.match(page,/Pause session/);
  assert.match(page,/Resume session/);
  assert.match(page,/End session/);
  assert.doesNotMatch(page,/className="topbar-focus-control"/);
  assert.doesNotMatch(page,/home-focus-widget|home-week-goal/);
  assert.match(page,/<\/div><\/header>/);
});
