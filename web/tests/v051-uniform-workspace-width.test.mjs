import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('all six tabs render under the same page-content wrapper', () => {
  assert.match(page, /<main className=\{'page-content'\+\(tab==='today'\?' dashboard-page':''\)\}>/);
  for (const tab of ['today', 'courses', 'tasks', 'calendar', 'focus', 'library']) {
    assert.match(page, new RegExp(`tab==='${tab}'`), `Missing navigation target: ${tab}`);
  }
});

test('Home no longer overrides the common workspace max width', () => {
  assert.match(css, /\.page-content\{width:100%;max-width:1430px;margin:0 auto/);
  assert.match(css, /\.dashboard-page\{padding:28px clamp\(20px,3\.5vw,58px\) 86px/);
  assert.doesNotMatch(css, /\.dashboard-page\s*\{[^}]*max-width:/);
});

test('large monitor width applies to every tab without altering Study columns', () => {
  assert.match(css, /@media\(min-width:1800px\)\{\.page-content\{max-width:1780px\}/);
  assert.match(css, /\.page-content:has\(\.planner-study-shell\) \.planner-classic-overview\{grid-template-columns:/);
  assert.doesNotMatch(css, /\.page-content:has\(\.planner-study-shell\)\{max-width:/);
});

test('laptop and mobile adaptive spacing stays active', () => {
  assert.match(css, /@media \(min-width:811px\) and \(max-width:1599px\)\{/);
  assert.match(css, /@media \(max-width:810px\)\{/);
  assert.match(css, /\.page-content\{padding-inline:16px\}/);
});
