import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/course-planner.tsx', import.meta.url), 'utf8');

test('semester and course toggles import their ChevronDown icon', () => {
  const iconsImport = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/s);
  assert.ok(iconsImport, 'lucide-react import must exist');
  const names = iconsImport[1].split(',').map(name => name.trim());
  assert.ok(names.includes('ChevronDown'), 'ChevronDown must be imported');
  assert.equal((source.match(/<ChevronDown\b/g) || []).length, 1); // Semester disclosure only; Create is now direct.
});
