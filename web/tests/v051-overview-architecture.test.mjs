import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const study = read('components/course-planner.tsx');
const home = read('app/page.tsx');
const css = read('app/globals.css');

test('Overview previews selected week files and reusable course references, with bounded lists',()=>{
  assert.match(study, /r\.course_id === selectedId && r\.week_number === weekNumber/);
  assert.match(study, /r\.week_number === null \|\| r\.week_number === undefined/);
  assert.match(study, /weekResources\.slice\(0,2\)\.map\(resourcePreviewRow\)/);
  assert.match(study, /sharedPreview = \[\.\.\.shared\]\.sort\([\s\S]*?\.slice\(0,3\)/);
  assert.match(study, /sharedPreview\.map\(resourcePreviewRow\)/);
  assert.match(study, /Week \{weekNumber\}/);
  assert.match(study, /View all <ArrowRight/);
  assert.match(study, /Open Course Library/);
});

test('resource previews navigate to documents but leave destructive controls in full tabs',()=>{
  const preview = study.slice(study.indexOf('const resourcePreviewRow'), study.indexOf('const resourceRow'));
  assert.match(preview, /onClick=\{\(\)=>openResource\(r\)\}/);
  assert.doesNotMatch(preview,/openResourceForm|removeResource/);
  assert.match(study,/workspaceTab==='course-library'&&<Card/);
  assert.match(study,/workspaceTab==='week-resources'&&<Card/);
  assert.match(study,/shared\.length\?shared\.map\(resourceRow\)/);
  assert.match(study,/weekResources\.length\?weekResources\.map\(resourceRow\)/);
  assert.match(study,/onClick=\{\(\)=>void removeResource\(r\)\}/);
  assert.match(study,/resource_id\?data\.resources\.find/);
});

test('Study progress clarifies scope without altering optimistic completion counts',()=>{
  assert.match(study,/const progressCourseItems=courseLearningItems\(progressItems,selectedId\)/);
  assert.match(study,/const progressWeekItems=progressCourseItems\.filter/);
  assert.match(study,/Course progress<\/span>/);
  assert.match(study,/course activities<\/small>/);
  assert.match(study,/Week \{weekNumber\} progress/);
});

test('Home course tiles summarize without duplicating priority action lists',()=>{
  const tile = home.slice(home.indexOf('studyGroups.map((group,index)'),home.indexOf('{studyGroups.length>3&&'));
  assert.match(tile,/weekTopic/);
  assert.match(tile,/todayCount/);
  assert.match(tile,/home-course-overview/);
  assert.match(tile,/home-course-progress/);
  assert.match(tile,/home-open-course/);
  assert.match(tile,/CourseActionsMenu/);
  assert.doesNotMatch(tile,/\.tasks\.slice\(0,2\)\.map/);
  assert.match(home,/className="home-priority-list"/);
  assert.match(home,/onClick=\{\(\)=>startFrom\(i\)\}/);
});

test('responsive styles share the Study width across tabs without changing fonts',()=>{
  assert.match(css,/\.page-content\{width:100%;max-width:1430px/);
  assert.match(css,/@media\(min-width:1800px\)\{\.page-content\{max-width:1780px\}/);
  assert.doesNotMatch(css,/\.dashboard-page\{max-width:/);
  assert.match(css,/page-content:has\(\.planner-study-shell\) \.planner-classic-overview/);
  assert.match(css,/@media\(min-width:811px\) and \(max-width:1599px\)/);
  assert.match(css,/home-course-grid\.course-count-1/);
  assert.match(css,/planner-resource-preview-copy/);
  assert.doesNotMatch(css,/\.planner-resource-preview-card[^\n]*font-size:18px/);
});
