import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('Focus page hero has no redundant Running or Paused status badge', () => {
  const focusSection = page.split("{tab==='focus'&&<>")[1]?.split('<div className="focus-layout">')[0];
  assert.ok(focusSection, 'Focus page heading should exist');
  assert.match(focusSection, /DEEP WORK/);
  assert.match(focusSection, /Find your flow\./);
  assert.doesNotMatch(focusSection, /<Badge/);
});

test('active session state is still shown by the timer and accessible global control', () => {
  assert.match(page, /<FocusDial session=\{active\} anchor=\{focusClock\}\/>/);
  assert.match(page, /className="topbar-focus-session"/);
  assert.match(page, /<Badge tone="good">Active session<\/Badge>/);
});
