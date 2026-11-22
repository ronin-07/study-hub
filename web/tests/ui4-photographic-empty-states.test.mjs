import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const page=read('app/page.tsx');
const course=read('components/course-planner.tsx');
const tasks=read('components/tasks-planner.tsx');
const photos=read('components/photo-empty-state.tsx');
const menu=read('components/course-actions-menu.tsx');
const css=read('app/globals.css');

test('five photographic assets are local optimized webp photographs, not remote calls',()=>{
  for(const scene of ['home','study','tasks','calendar','resources']){
    const path=new URL(`../public/empty-states/${scene}.webp`,import.meta.url);
    const image=readFileSync(path);
    assert.equal(image.toString('ascii',0,4),'RIFF');
    assert.equal(image.toString('ascii',8,12),'WEBP');
    assert.ok(statSync(path).size<90000,`${scene} should remain optimized`);
    assert.ok(css.includes(`url('/empty-states/${scene}.webp')`));
  }
  assert.match(photos,/<div className="photo-empty-backdrop" aria-hidden="true"\/>/);
  assert.doesNotMatch(photos, /next\/image|<Image/);
});

test('Home photos appear only for empty course/day projections, without altering live task rows',()=>{
  assert.match(page,/studyGroups\.length\?<\>/);
  assert.match(page,/<PhotoEmptyState compact scene="home" title="Your day is clear"/);
  assert.match(page,/filteredPriorities\.length\?<div className="home-priority-list"/);
  assert.match(page,/priorityFilter==='all'\?<PhotoEmptyState compact scene="home"/);
  assert.match(page,/onAction=\{\(\)=>\{setTaskForm\(true\);setTab\('tasks'\);\}\}/);
});

test('Study photos appear only for no semester, no selected active course, or empty resource tabs',()=>{
  assert.match(course,/!semester \? <div className="planner-empty-main"><PhotoEmptyState scene="study"/);
  assert.match(course,/: !selected \? showArchived\?<div/);
  assert.match(course,/workspaceTab==='course-library'/);
  assert.match(course,/shared\.length\?shared\.map\(resourceRow\):<PhotoEmptyState scene="resources"/);
  assert.match(course,/weekResources\.length\?weekResources\.map\(resourceRow\):<PhotoEmptyState scene="study"/);
});

test('Calendar and Tasks photos are conditional and only expose existing add-task flow',()=>{
  assert.match(tasks,/!scheduled\.length&&!due\.length\?<PhotoEmptyState compact scene="calendar"/);
  assert.match(tasks,/listed\.length\?listed\.map/);
  assert.match(tasks,/:<PhotoEmptyState scene="tasks"/);
  assert.match(tasks,/onAction=\{\(\)=>startCreate\(selectedDay\)\}/);
});

test('Resources photo does not incorrectly describe filtered or populated index as empty',()=>{
  assert.match(page,/!drive\.connected&&data\.resources\.length===0&&<PhotoEmptyState compact scene="resources"/);
  assert.match(page,/indexedVisible\.length===0&&\(driveIndex\.length===0\?<PhotoEmptyState compact scene="resources"/);
});

test('course actions menu has three contextual actions, escape/outside dismiss, and accessible keyboard navigation',()=>{
  assert.match(page,/<CourseActionsMenu courseId=\{group\.course\.id\}/);
  assert.match(page,/onViewTasks=\{\(\)=>openCourse\(group\.course\.id,undefined,undefined,'tasks'\)\}/);
  assert.match(page,/onFocus=\{\(\)=>focusOnCourse\(group\.course\.id\)\}/);
  assert.match(page,/if\(!active&&!busy&&!focusBusyRef\.current\)void startFocus\(id,'',focusMode\)/);
  assert.match(page,/onLibrary=\{\(\)=>openCourse\(group\.course\.id,undefined,undefined,'course-library'\)\}/);
  assert.match(menu,/aria-haspopup="menu"/);
  assert.match(menu,/createPortal\(/);
  assert.match(menu,/document\.addEventListener\('pointerdown',dismiss\)/);
  assert.match(menu,/event\.key==='Escape'/);
  assert.match(menu,/ArrowDown','ArrowUp','Home','End'/);
  for(const action of ['View course tasks','Start focus session','Open course library'])assert.ok(menu.includes(action));
  assert.match(course,/if\(sectionJump\?\.courseId===selectedId\)setWorkspaceTab\(sectionJump\.section\)/);
});

test('photography and menu style preserve reduced-motion requirements and mobile sizing',()=>{
  assert.match(css,/\.photo-empty-state\.compact/);
  assert.match(css,/\.photo-empty-backdrop/);
  assert.match(css,/\.home-course-menu\{position:fixed/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.photo-empty-actions button/);
});
