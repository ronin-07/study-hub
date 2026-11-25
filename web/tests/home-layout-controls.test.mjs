import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=read('app/page.tsx');
const course=read('components/course-planner.tsx');
const css=read('app/globals.css');

test('Home priorities follow the course panel in a column independent of the calendar',()=>{
  assert.match(home,/<div className="home-main-column">\s*<section className="home-panel home-course-panel"[\s\S]*?<section className="home-panel home-priorities"[\s\S]*?<\/section>\s*<\/div>\s*<div className="home-side-column">/);
  assert.match(css,/\.home-main-column,\.home-side-column\{display:flex;flex-direction:column;/);
  assert.match(css,/\.home-main-column\{gap:inherit;\}/);
  assert.doesNotMatch(css,/\.home-main-column\{display:contents/);
});
test('course carousel is accessible and reaches every course',()=>{
  assert.match(home,/studyGroups\.map\(\(group,index\)=>/);
  assert.match(home,/ref=\{courseScrollerRef\} onScroll=\{syncCourseScroll\}/);
  assert.match(home,/aria-label=\"Previous course cards\"/);
  assert.match(home,/aria-label=\"Next course cards\"/);
  assert.match(home,/disabled=\{!canScrollNextCourse\}/);
});
test('priority labels open their destination without stealing checkbox or Focus events',()=>{
  assert.match(home,/className=\"home-priority-info\" aria-label=\{`Open \$\{i\.title\}`\} onClick=\{\(\)=>openDeadlineDestination\(i\)\}/);
  assert.match(home,/onChange=\{\(\)=>toggle\(i\)\}/);
  assert.match(home,/onClick=\{\(\)=>startFrom\(i\)\}/);
  assert.match(css,/\.home-priority-list\{gap:7px;\}/);
  assert.match(css,/\.home-priority-row\.overdue::before/);
});
test('semester navigation starts expanded and courses stay nested without duplicate panel',()=>{
  assert.match(course,/\[semestersExpanded, setSemestersExpanded\] = useState\(true\)/);
  assert.match(course,/aria-expanded=\{semestersExpanded\} aria-controls="planner-semester-section"/);
  assert.match(course,/onSemesterRowClick\(s\.key\)/);
  assert.doesNotMatch(course,/planner-course-section/);
});
