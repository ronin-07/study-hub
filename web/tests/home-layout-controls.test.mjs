import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=read('app/page.tsx');
const course=read('components/course-planner.tsx');
const css=read('app/globals.css');

test('course panel spans both Home columns while priorities and widgets remain beside each other',()=>{
  assert.match(css,/\.home-main-column\{display:contents;\}/);
  assert.match(css,/\.home-course-panel\{grid-column:1\/-1;/);
  assert.match(css,/\.home-priorities\{grid-column:1;/);
  assert.match(css,/\.home-side-column\{grid-column:2;grid-row:3;/);
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
test('semester and course rail panels are independently collapsible and expanded initially',()=>{
  assert.match(course,/\[semestersExpanded, setSemestersExpanded\] = useState\(true\)/);
  assert.match(course,/\[coursesExpanded, setCoursesExpanded\] = useState\(true\)/);
  assert.match(course,/aria-expanded=\{semestersExpanded\} aria-controls=\"planner-semester-section\"/);
  assert.match(course,/aria-expanded=\{coursesExpanded\} aria-controls=\"planner-course-section\"/);
});
