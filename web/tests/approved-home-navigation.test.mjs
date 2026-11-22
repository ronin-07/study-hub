import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const home=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const planner=readFileSync(new URL('../components/course-planner.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

test('Home keeps three equal course cards and elevates deadlines and inline calendar alongside priorities',()=>{
  assert.match(home,/home-course-grid/);
  assert.match(home,/home-side-column/);
  assert.match(home,/home-panel home-deadlines/);
  assert.match(home,/home-panel home-week-strip/);
  assert.match(home,/home-panel home-priorities/);
  assert.match(css,/\.home-course-grid\{display:grid;grid-auto-flow:column;grid-auto-columns:calc\(\(100% - 28px\)\/3\)/);
  assert.doesNotMatch(home,/home-focus-widget|home-week-goal/);
});

test('weekly goal moved from Home to Focus, with existing saved target',()=>{
  assert.match(home,/tab===\x27focus\x27&&<>/);
  assert.match(home,/className="focus-week-goal"/);
  assert.match(home,/studyhub-focus-goal/);
  assert.match(home,/aria-label="Weekly focus target in hours"/);
});

test('Quick Focus supports task-linking, selection, active timer and pause control',()=>{
  assert.match(home,/quickFocusMode/);
  assert.match(home,/quickFocusCourse/);
  assert.match(home,/quickFocusItem/);
  assert.match(home,/focusTasksForContext\(data\.items,quickFocusCourse\)/);
  assert.match(home,/startFocus\(quickFocusCourse,quickFocusItem,quickFocusMode\)/);
  assert.match(home,/<FocusElapsed session=\{active\} anchor=\{focusClock\}\/>/);
  assert.match(home,/Pause session/);
  assert.match(home,/Resume session/);
  assert.match(home,/document\.addEventListener\(\x27pointerdown\x27,onOutside\)/);
});

test('Study navigation nests course links beneath independently collapsible semesters',()=>{
  assert.match(planner,/planner-semester-tree/);
  assert.match(planner,/planner-semester-children/);
  assert.match(planner,/planner-semester-course/);
  assert.match(planner,/aria-expanded=\{expanded\}/);
  assert.match(planner,/setOpenSemesterKeys/);
  assert.match(planner,/studyhub-expanded-semesters/);
  assert.match(planner,/const \[semestersExpanded, setSemestersExpanded\] = useState\(true\)/);
  assert.doesNotMatch(planner,/className="planner-course-list"/);
  assert.match(planner,/Archived courses/);
  assert.doesNotMatch(planner,/planner-course-section/);
});
