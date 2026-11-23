import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const page=read('app/page.tsx');
const study=read('components/course-planner.tsx');
const css=read('app/globals.css');

test('six global destinations and profile footer; no course shortcuts outside Study',()=>{
  for (const [id,label] of [['today','Home'],['courses','Study'],['tasks','Tasks'],['calendar','Calendar'],['focus','Focus'],['library','Resources']]) {
    assert.ok(page.includes(`id:'${id}',label:'${label}'`));
  }
  assert.doesNotMatch(page,/sidebar-courses|sidebar-course-link/);
  assert.match(page,/className="sidebar-profile"/);
  assert.match(page,/className="sidebar-footer-row"/);
});

test('topbar session badge reveals session controls and global end-session review',()=>{
  assert.match(page,/aria-controls="active-focus-menu"/);
  assert.match(page,/setQuickFocusOpen\(value=>!value\)/);
  assert.match(page,/sessionAction\(active\.status==='running'\?'pause':'resume'\)/);
  assert.match(page,/reviewFinish\(\)/);
  assert.doesNotMatch(page,/className="topbar-focus-control"/);
  const focusSection=page.indexOf("{tab==='focus'&&<>");
  const dialog=page.indexOf('{finishReview&&active&&<div className="dialog-backdrop"');
  assert.ok(dialog>focusSection,'shared review dialog appears after the Focus page');
  assert.match(css,/\.active-focus-menu\{/);
});

test('approved classic Study layout has hero, direct actions, checklist, week resources and shared library',()=>{
  assert.match(study,/planner-study-add-semester/);
  assert.match(study,/Edit semester/);
  assert.match(study,/planner-study-hero/);
  assert.match(study,/planner-hero-progress/);
  assert.match(study,/planner-study-week-toolbar/);
  assert.match(study,/Weekly learning checklist/);
  assert.match(study,/Link lecture slides/);
  assert.match(study,/Shared course library/);
  assert.match(study,/Open Course Library/);
  assert.doesNotMatch(study,/className="planner-study-notes-card"/);
  assert.match(study,/planner-study-library-scroll/);
  assert.match(study,/aria-label="Teaching week"/);
  assert.match(study,/planner-study-filters/);
  assert.doesNotMatch(study,/study-create-menu|planner-icon-menu/);
  assert.match(css,/\.planner-classic-overview\{/);
});
