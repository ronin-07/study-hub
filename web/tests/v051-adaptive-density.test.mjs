import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

function blockAfter(marker) {
  const from = css.lastIndexOf(`${marker}{`);
  assert.ok(from >= 0, `Expected CSS block: ${marker}`);
  const start = css.indexOf('{', from);
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i);
  }
  throw new Error(`Unclosed CSS block: ${marker}`);
}

test('wide monitors retain original 18px typography and generous Study layout', () => {
  assert.match(css, /html\{font-size:18px\}/);
  const laptop = blockAfter('@media (min-width:811px) and (max-width:1599px)');
  assert.match(laptop, /html\{font-size:17px\}/);
  assert.match(laptop, /\.planner-classic-overview\{grid-template-columns:/);
  assert.match(laptop, /\.home-panel\{padding:16px/);
  assert.match(laptop, /\.focus-card\{padding:23px\}/);
  assert.match(laptop, /\.pdf-reading-layout\{grid-template-columns:/);
  assert.match(laptop, /\.planner-v05-shell\{padding:17px\}/);
  assert.match(laptop, /\.dialog\{padding:22px/);
});

test('smaller laptop viewports reduce spacing, not study content or available actions', () => {
  const compact = blockAfter('@media (min-width:811px) and (max-width:1279px)');
  assert.match(compact, /html\{font-size:16\.5px\}/);
  assert.match(compact, /\.planner-activity-actions\{grid-column:2/);
  const container = blockAfter('@container study-workspace (max-width:720px)');
  assert.match(container, /\.planner-classic-overview\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.planner-workspace\{[^}]*container-type:inline-size;container-name:study-workspace/);
  assert.doesNotMatch(compact, /display:none/);
});

test('mobile styles continue stacking layouts and preserve accessible action sizes', () => {
  const mobile = blockAfter('@media (max-width:810px)');
  assert.match(mobile, /html\{font-size:17px\}/);
  assert.match(mobile, /\.planner-study-shell\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(mobile, /\.planner-learning-checklist \.planner-activity-actions \.icon-btn\{min-width:32px;min-height:32px\}/);
  assert.match(mobile, /\.planner-activity-document\{width:100%\}/);
});

test('short laptop screens reduce vertical padding without changing Focus timing', () => {
  const short = blockAfter('@media (min-width:811px) and (max-width:1599px) and (max-height:800px)');
  assert.match(short, /\.timer-dial\{width:228px;height:228px;margin:20px auto\}/);
  assert.match(short, /\.planner-study-hero\{min-height:86px/);
  assert.doesNotMatch(short, /animation|focus-progress|remaining-ms/);
});
