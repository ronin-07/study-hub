import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatStudyReference, kindLabels } from '../lib/types.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('reference display separates comma-delimited numbers but retains subchapter decimals', () => {
  assert.equal(formatStudyReference('4,5.6,4.2.1'), '4, 5.6, 4.2.1');
  assert.equal(formatStudyReference('3.1, 4.11, 5'), '3.1, 4.11, 5');
  assert.equal(formatStudyReference(' Question 3 ,  4.2.1 '), 'Question 3, 4.2.1');
  assert.equal(formatStudyReference(''), '');
});

test('Questions is a first-class activity kind with a question-specific form label', () => {
  const study = read('components/course-planner.tsx');
  const tasks = read('components/tasks-planner.tsx');
  assert.equal(kindLabels.questions, 'Questions');
  assert.match(study, /'reading','questions','revision'/);
  assert.match(study, /itemDraft\.kind==='questions'\?'Question numbers':'Chapter \/ section'/);
  assert.match(study, /activityReference\(i\)/);
  const display = read('lib/activity-display.ts');
  assert.match(display, /item\.kind === 'questions' \? 'Questions'/);
  assert.match(display, /formatStudyReference\(item\.chapter\)/);
  assert.match(tasks, /'reading','questions','notes'/);
});

test('Tasks checkbox explanation is removed; accessible label stays visible', () => {
  const study = read('components/course-planner.tsx');
  const css = read('app/globals.css');
  assert.match(study, /Include in Tasks and Calendar<\/label>/);
  assert.doesNotMatch(study, /Uncheck to keep this activity only/);
  assert.doesNotMatch(css, /planner-task-visibility-hint/);
  assert.match(css, /\.planner-dialog \.inline-check/);
  assert.match(css, /\.planner-study-ref-value\{[^}]*letter-spacing:/);
});
