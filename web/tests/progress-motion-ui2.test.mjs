import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {clampPercent, easedProgress, reachedMilestone, visibleCourseDoneCount, PROGRESS_ANIMATION_MS} from '../lib/progress-presentation.ts';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const page = read('app/page.tsx');
const study = read('components/course-planner.tsx');
const component = read('components/progress-motion.tsx');
const css = read('app/globals.css');

test('progress clamps invalid values and smoothly interpolates in either direction', () => {
  assert.equal(PROGRESS_ANIMATION_MS,450);
  assert.equal(clampPercent(-10),0);
  assert.equal(clampPercent(134),100);
  assert.equal(clampPercent(Number.NaN),0);
  assert.equal(clampPercent(Number.POSITIVE_INFINITY),0);
  assert.equal(easedProgress(20,80,0),20);
  assert.equal(easedProgress(20,80,1),80);
  assert.ok(easedProgress(20,80,.5)>50);
  assert.ok(easedProgress(80,20,.5)<50);
});

test('milestone only triggers when a non-complete value reaches 100', () => {
  assert.equal(reachedMilestone(75,100),true);
  assert.equal(reachedMilestone(0,100),true);
  assert.equal(reachedMilestone(100,100),false);
  assert.equal(reachedMilestone(100,75),false);
  assert.equal(reachedMilestone(0,0),false);
});

test('progress transitions are scoped to the progress components and not whole dashboard', () => {
  assert.match(component,/useRef\(value\)/);
  assert.match(component,/previousRef\.current === value/);
  assert.match(component,/window\.cancelAnimationFrame\(frame\)/);
  assert.match(component,/prefersReducedMotion\(\)/);
  assert.match(component,/aria-valuenow=\{percentage\}/);
  assert.match(component,/previous\.identity !== identity/);
  assert.match(component,/transform:`scaleX\(\$\{percentage\/100\}\)`/);
  assert.match(css,/transition:transform 450ms/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('Study course and weekly progress use canonical optimistic items, not the held checkbox projection', () => {
  assert.match(page,/progressItems=\{data\.items\}/);
  assert.match(study,/const progressCourseItems=courseLearningItems\(progressItems,selectedId\)/);
  assert.match(study,/progressWeekItems=progressCourseItems\.filter/);
  assert.match(study,/ProgressTrack key=\{selectedId\}/);
  assert.match(study,/ProgressValue key=\{`\$\{selectedId\}-\$\{weekNumber\}`\}/);
});

test('Home course cards preserve completion animation while progress advances immediately', () => {
  assert.match(page,/studyGroups = useMemo\(\(\)=>todayStudyCourses\(data\.courses,presentedItems,today\)/);
  assert.match(page,/completedItemIds = useMemo\(\(\)=>new Set\(data\.items\.filter/);
  assert.match(page,/visibleCourseDoneCount\(group\.doneCount,group\.activityCount,group\.tasks,completingIds,completedItemIds\)/);
  assert.match(page,/className="home-progress-track" identity=\{group\.course\.id\}/);
});

test('Focus goal and actual session statistics are visual-only animations', () => {
  assert.match(page,/label="Weekly focus goal progress" value=\{weekPct\}/);
  assert.match(page,/formatFocusDuration\(weekSeconds\)/);
  assert.match(page,/formatFocusDuration\(totalSeconds\)/);
  assert.match(component,/setTimeout\(\(\) => setCelebrating\(false\), 2200\)/);
  assert.match(css,/\.planner-study-hero:has\(\.progress-celebrating\)/);
});

test('held completion is counted once immediately, and a failed save rolls it back', () => {
  const tasks=[{id:'a'},{id:'b'}];
  const held=new Set(['b']);
  assert.equal(visibleCourseDoneCount(1,2,tasks,held,new Set(['a','b'])),2);
  assert.equal(visibleCourseDoneCount(1,2,tasks,held,new Set(['a'])),1);
  assert.equal(visibleCourseDoneCount(2,2,tasks,new Set(),new Set(['a','b'])),2);
  assert.equal(visibleCourseDoneCount(2,2,tasks,held,new Set(['a','b'])),2,'cannot exceed activity count');
});
