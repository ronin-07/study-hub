import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('zero confirmed seconds use atomic DELETE rather than finish-and-count', () => {
  assert.match(source, /if\(confirmed===0\)\{void discardEmptyFocus\(active\.id\);return;\}/);
  assert.match(source, /await api<void>\(`\/api\/sessions\/\$\{identifier\}`,user,\{method:'DELETE'\}\)/);
  assert.match(source, /sessions:previous\.sessions\.filter\(s=>s\.id!==identifier\)/);
  assert.match(source, /Discard empty session/);
  assert.match(source, /Empty session discarded/);
  assert.match(source, /focusBusyRef\.current=true/);
});

test('old zero-length finished sessions are excluded from fallback count and recent list', () => {
  assert.match(source, /data\.sessions\.filter\(s=>s\.status==='finished'&&\(s\.focus_seconds\|\|0\)>0\)/);
  assert.match(source, /data\.sessions\.some\(s=>s\.status==='finished'&&\(s\.focus_seconds\|\|0\)>0\)/);
});
