import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const types = readFileSync(new URL('../lib/types.ts', import.meta.url), 'utf8');

test('load requests compact sessions without losing server-maintained statistics', () => {
  assert.match(page, /\/api\/snapshot\?compact=true&week_start=/);
  assert.match(types, /focus_stats\?: FocusStats/);
  assert.match(page, /data\.focus_stats\?\.total_seconds \?\? all/);
  assert.match(page, /data\.focus_stats\?\.completed_sessions \?\? data\.sessions\.filter/);
});

test('local focus completion preserves summary and in-flight snapshot cannot overwrite it', () => {
  assert.match(page, /focusRevisionAtStart===focusRevisionRef\.current&&!focusBusyRef\.current/);
  assert.match(page, /return focusUnchanged\?next:\{\.\.\.next,sessions:previous\.sessions,focus_stats:previous\.focus_stats\}/);
  assert.match(page, /const changedToFinished = saved\.status==='finished'/);
  assert.match(page, /total_seconds:previous\.focus_stats\.total_seconds \+ Math\.max\(0,saved\.focus_seconds\|\|0\)/);
});
