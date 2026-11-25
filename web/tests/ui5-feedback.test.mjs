import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {appendFeedback, feedbackDismissDelay} from '../lib/feedback-queue.ts';
const read = file => readFileSync(join(process.cwd(),file),'utf8');

test('feedback queue deduplicates success notifications and bounds the stack', () => {
  const toast=(title,kind='success')=>({title,kind});
  let q=[];
  q=appendFeedback(q,toast('Saved'));
  q=appendFeedback(q,toast('Saved'));
  assert.equal(q.length,1);
  for(const title of ['Course created','Session saved','PDF linked'])q=appendFeedback(q,toast(title));
  assert.equal(q.length,3);
  assert.equal(q.at(-1).title,'PDF linked');
});

test('errors remain visible; successful operations do not evict a full error stack', () => {
  const err=title=>({title,kind:'error'});
  const q=[err('Offline'),err('Unauthorized'),err('Could not save')];
  assert.deepEqual(appendFeedback(q,{title:'Other saved',kind:'success'}),q);
  assert.equal(feedbackDismissDelay('error'),null);
  assert.equal(feedbackDismissDelay('success'),3500);
  assert.equal(feedbackDismissDelay('success',true),8000);
});

test('mutation handler synchronously guards duplicate requests and shows success only after write', () => {
  const page=read('app/page.tsx');
  assert.match(page,/if \(mutationBusyRef\.current\) return false;/);
  assert.match(page,/mutationBusyRef\.current=true/);
  assert.match(page,/const result=await fn\(\)/);
  assert.match(page,/if\(feedback\)notify\(\{kind:'success'/);
  assert.match(page,/finally \{resourceRemovalBusyRef\.current=false;mutationBusyRef\.current=false;setBusy\(false\);\}/);
});

test('meaningful saves are labeled and course archive has an Undo action', () => {
  const study=read('components/course-planner.tsx');
  const tasks=read('components/tasks-planner.tsx');
  const page=read('app/page.tsx');
  for(const label of ['Semester created','Course created','Week saved','Activity updated','Resource linked','Course archived','Course restored'])assert.ok(study.includes(label),label);
  assert.match(study,/action:\{label:'Undo'/);
  assert.ok(tasks.includes('Task created'));
  assert.ok(page.includes('Drive scan completed'));
  assert.ok(page.includes('Focus session saved'));
  assert.match(tasks,/if\(ok\)closeForm\(\);/);
});

test('toast placement, accessible status, persistent errors and reduced motion', () => {
  const component=read('components/feedback-toasts.tsx');
  const css=read('app/globals.css');
  assert.match(component,/role=\{kind === 'error' \? 'alert' : 'status'\}/);
  assert.match(component,/feedbackDismissDelay/);
  assert.match(css,/\.study-feedback-stack\{position:fixed;top:76px;right:24px/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.study-feedback-toast\{animation:none\}\}/);
});
