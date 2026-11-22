import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = read('app/page.tsx');
const study = read('components/course-planner.tsx');
const tasks = read('components/tasks-planner.tsx');
const config = read('next.config.ts');

// These checks protect deliberate release-level changes; behavioral browser
// testing is still required for keyboard/menu/Focus/calendar interactions.
test('mobile navigation shares the desktop navigation handler', () => {
  assert.match(page, /<nav className="mobile-nav"[^>]*>\{tabs\.map\(t=><button[^>]*onClick=\{\(\)=>navigate\(t\.id\)\}/);
  assert.doesNotMatch(page, /<nav className="mobile-nav"[^>]*>\{tabs\.map\(t=><button[^>]*onClick=\{\(\)=>setTab\(t\.id\)\}/);
});

test('non-essential marketing and debug text is removed without hiding safety copy', () => {
  for (const source of [page, study, tasks]) {
    for (const marketing of [
      'Stay consistent, one focused step at a time.',
      'Make room for what matters.',
      'Your resources, lecture notes, and next study actions are right here.',
      'Keep using Goodnotes',
      'Your time, mapped out.',
    ]) assert.equal(source.includes(marketing), false, `Unnecessary text: ${marketing}`);
  }
  assert.match(page, /Timed sessions end manually/);
  assert.match(page, /Adjust for idle time if needed/);
  assert.match(study, /Unfinished tasks won.t appear in Today/);
  assert.match(tasks, /Cannot plan after/);
});

test('the approved study tabs and six global routes remain unchanged', () => {
  for (const label of ['Home','Study','Tasks','Calendar','Focus','Resources'])
    assert.match(page, new RegExp(`label:'${label}'`));
  for (const name of ['Overview','Course library','Week resources','Study tasks','Exam prep'])
    assert.ok(study.includes(name), `Missing course tab: ${name}`);
});

test('production frontend includes conservative security headers', () => {
  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /X-Frame-Options/);
  assert.match(config, /Referrer-Policy/);
  assert.match(config, /Permissions-Policy/);
});
