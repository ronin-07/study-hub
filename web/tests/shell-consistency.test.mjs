import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

test('the account footer is identical on Home and every other tab',()=>{
  assert.match(page,/<div className="sidebar-bottom">/);
  assert.match(page,/className="sidebar-profile"/);
  assert.match(page,/className="sidebar-footer-row"/);
  assert.match(page,/<aside className="sidebar">/);
  assert.match(page,/<small>DTU<\/small>/);
  assert.doesNotMatch(page,/RepLap stays in its own project/);
  assert.doesNotMatch(page,/tab==='today'\?<div className="sidebar-profile"/);
  assert.match(page,/Sign out of Study Hub/);
});

test('date and clock are beside each other and share all tabs',()=>{
  assert.match(page,/className="topbar-date">\{dateLabel\}<\/span>\s*<span className="topbar-clock"/);
  assert.match(page,/const timeLabel=clockReady\?formatLocalClock/);
  assert.match(page,/setClockReady\(true\)/);
  assert.match(css,/\.dashboard-topbar \.topbar-clock/);
  assert.match(css,/\.topbar-clock\{/);
});

test('no redundant header Quick focus button on secondary tabs',()=>{
  assert.doesNotMatch(page,/Quick focus/);
  assert.doesNotMatch(css,/\.topbar-focus/);
  assert.match(page,/<\/div><\/header>/);
});
