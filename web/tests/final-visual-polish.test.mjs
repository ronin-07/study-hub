import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const page = read('app/page.tsx');
const css = read('app/globals.css');
const study = read('components/course-planner.tsx');
const dial = read('components/focus-elapsed.tsx');
const polish = read('components/visual-polish.tsx');
const common = read('components/common.tsx');
const tasks = read('components/tasks-planner.tsx');

test('task animations include existing optimism and respect reduced motion', () => {
  assert.match(page, /setData\(previous=>\(\{\.\.\.previous,items:previous\.items\.map/);
  assert.match(css, /@keyframes study-task-check-pop/);
  for (const cls of ['home-priority-row', 'home-course-task', 'planner-study-task', 'planner-v05-task']) {
    assert.ok(css.includes(`.${cls} input[type=checkbox]:checked`), cls);
  }
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)[\s\S]*\.timer-dial\.focus-target-reached/);
});

test('progress numbers and bars follow data with no decorative animation on first paint', () => {
  assert.match(study, /<AnimatedPercent value=\{courseCompletion\}/);
  assert.match(page, /<AnimatedPercent className="home-progress-percent" value=\{progress\}/);
  assert.match(page, /<AnimatedPercent value=\{weekPct\}/);
  assert.match(css, /transition:width 520ms/);
  assert.match(polish, /useState\(target\)/);
  assert.match(polish, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(polish, /cancelAnimationFrame/);
});

test('focus target glow leaves countdown and mode semantics intact', () => {
  assert.match(dial, /focusClockDisplaySeconds\(clock, session\.mode/);
  assert.match(dial, /targetReached = session\.mode !== 'free'/);
  assert.match(dial, /focus-target-reached/);
  assert.match(css, /@keyframes focus-target-halo/);
  assert.doesNotMatch(dial, /setInterval\(.*1000/);
});

test('save notification uses existing API mutation workflow and accessible feedback', () => {
  assert.match(page, /setFeedback\(\{tone:'saving',message:'Saving changes…'\}\)/);
  assert.match(page, /setFeedback\(\{tone:'success',message:'Changes saved'\}\)/);
  assert.match(page, /setFeedback\(\{tone:'error',message:'Could not save changes'\}\)/);
  assert.match(page, /<SaveFeedback feedback=\{feedback\}/);
  assert.match(polish, /role=\{feedback\.tone === 'error' \? 'alert' : 'status'\}/);
});

test('empty state icons and original local photographs do not add external requests', () => {
  assert.match(study, /study-inline-empty/);
  assert.match(page, /home-side-empty study-inline-empty/);
  for (const name of ['study-desk-dusk.webp','study-library-dusk.webp']) {
    const path=resolve(root,'public',name);
    assert.deepEqual(readFileSync(path).subarray(0,4).toString('ascii'),'RIFF');
    assert.ok(statSync(path).size < 90_000, `${name} is not optimized`);
    assert.ok(css.includes(`/${name}`));
  }
});


test('photographs only appear when content is empty', () => {
  assert.match(common, /photo\?: 'desk' \| 'library'/);
  assert.match(tasks, /photo=\{mode==='completed'/);
  assert.match(study, /title="No weekly materials" photo="desk"/);
  assert.match(study, /title="Your shared library is empty" photo="library"/);
  assert.match(page, /home-course-empty home-course-empty--photo/);
  assert.doesNotMatch(css, /\.home-course-tile::before/);
  assert.doesNotMatch(css, /\.planner-study-hero::before/);
});

test('completed course progress shows a subtle finished state without confetti', () => {
  assert.match(study, /courseCompletion===100/);
  assert.match(css, /\.planner-study-hero\.is-complete/);
  assert.match(css, /\.home-course-tile\.is-complete/);
});
