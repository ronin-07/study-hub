import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('app/globals.css');
const focus = read('components/focus-elapsed.tsx');
const progress = read('components/progress-motion.tsx');

test('weekly checklist task rows have the same comfortable insets before and during completion',()=>{
  const row=css.match(/\.planner-learning-checklist \.planner-study-task\{([^}]+)\}/)?.[1];
  assert.ok(row);
  assert.match(row,/margin:4px 0/);
  assert.match(row,/padding:12px 14px/);
  assert.match(row,/border-radius:10px/);
  const overdue=css.match(/\.planner-learning-checklist \.planner-study-task\.overdue\{([^}]+)\}/)?.[1];
  assert.ok(overdue);
  assert.match(overdue,/padding:12px 14px/);
  assert.doesNotMatch(overdue,/border-left:3px/);
});

test('Home course checklist rows always keep the tick inset from their highlight',()=>{
  const row=css.match(/\.home-course-task\{([^}]+)\}/)?.[1];
  assert.ok(row);
  assert.match(row,/padding:7px 10px/);
  assert.match(row,/border-radius:10px/);
  assert.match(row,/gap:10px/);
  assert.match(css,/\.app-shell \.task-completion-row\.is-completing\{/);
});

test('100% course and card milestones stay visible long enough without replay on initial render',()=>{
  assert.match(progress,/setTimeout\(\(\) => setCelebrating\(false\), 2200\)/);
  assert.match(progress,/previousRef = useRef\(\{identity, percentage\}\)/);
  assert.match(progress,/reachedMilestone\(previous\.percentage, percentage\)/);
  assert.match(css,/progress-course-milestone 2\.2s/);
  assert.match(css,/progress-milestone-sheen 2\.2s/);
  assert.match(css,/progress-milestone-sparkle 2\.2s/);
});

test('Focus target glows once on a crossing, not for Stopwatch or an already-expired initial session',()=>{
  assert.match(focus,/session\.mode !== 'free' && elapsedSeconds >= Number\(session\.mode\) \* 60/);
  assert.match(focus,/useRef\(\{sessionId:session\.id, reached:targetReached\}\)/);
  assert.match(focus,/if \(previous\.reached \|\| !targetReached\) return/);
  assert.match(focus,/focus-target-celebrating/);
  assert.match(focus,/setTimeout\(\(\) => setTargetCelebrating\(false\), 2100\)/);
  assert.match(focus,/prefers-reduced-motion: reduce/);
  assert.match(css,/@keyframes focus-target-halo/);
  assert.match(css,/@keyframes focus-target-ring-glow/);
  assert.match(css,/\.timer-dial\.focus-target-celebrating::before/);
});

test('Polish 3 keeps all motion optional and leaves timer math outside the change',()=>{
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.timer-dial\.focus-target-celebrating,\.timer-dial\.focus-target-celebrating::before\{animation:none!important\}/);
  assert.match(css,/\.progress-motion-track\.progress-celebrating::after\{animation:none!important;display:none\}/);
  assert.match(focus,/focusClockSeconds\(clock, wallMs, monoMs\)/);
  assert.match(focus,/focusClockDisplaySeconds\(clock, session\.mode, wallMs, monoMs\)/);
});
