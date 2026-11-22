import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('sidebar course shortcuts appear outside Study without impossible active tab comparison', () => {
  const start = source.indexOf("{tab!=='courses'&&data.courses.some");
  const end = source.indexOf('<div className="sidebar-spacer"/>', start);
  assert.ok(start >= 0 && end > start, 'sidebar shortcuts present');
  const shortcuts = source.slice(start, end);
  assert.match(shortcuts, /className="sidebar-course-link"/);
  assert.doesNotMatch(shortcuts, /tab\s*===\s*'courses'/);
});
