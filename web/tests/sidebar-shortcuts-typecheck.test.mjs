import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('global sidebar only contains six primary tabs and never duplicates course shortcuts', () => {
  assert.match(source, /const tabs: \{id:Tab; label:string; icon:typeof Home\}\[\] = \[/);
  for (const label of ['Home', 'Study', 'Tasks', 'Calendar', 'Focus', 'Resources']) {
    assert.match(source, new RegExp(`label:'${label}'`));
  }
  assert.match(source, /className="side-nav" aria-label="Main navigation"/);
  assert.doesNotMatch(source, /sidebar-courses|sidebar-course-link|sidebar-course-code/);
  assert.match(source, /<div className="sidebar-spacer"\/>/);
});
