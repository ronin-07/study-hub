// Source-level navigation contracts. These protect the wiring until browser E2E tests run in Preview.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const page=readFileSync(resolve(web,'app/page.tsx'),'utf8');
const planner=readFileSync(resolve(web,'components/tasks-planner.tsx'),'utf8');
const styles=readFileSync(resolve(web,'app/globals.css'),'utf8');

test('Calendar has a standalone sidebar view instead of a Tasks sub-tab',()=>{
 assert.match(page, /\{id:'calendar',label:'Calendar',icon:CalendarDays\}/);
 assert.match(page, /setTab\('calendar'\)/);
 assert.match(page, /tab==='calendar'&&<TasksPlanner/);
 assert.match(page, /calendarOnly calendarJump=\{calendarJump\}/);
 assert.match(planner, /\(\['today','upcoming','completed'\] as const\)/);
});

test('Home day chips expand a local agenda and full calendar retains selected day',()=>{
 assert.match(page, /onClick=\{\(\)=>toggleHomeAgenda\(day\.date\)\}/);
 assert.match(page, /agendaForDate\(openTasks,homeSelectedDate\)/);
 assert.match(page, /onClick=\{\(\)=>openCalendarDate\(homeSelectedDate\|\|today\)\}/);
 assert.match(page, /onClick=\{\(\)=>openCalendarDate\(homeSelectedDate\)\}/);
 assert.match(planner, /selectCalendarDay\(calendarJump\.date\)/);
});

test('Home deadline links open course/week, or highlight a personal task, without editor',()=>{
 assert.match(page, /onClick=\{\(\)=>openDeadlineDestination\(i\)\}/);
 assert.match(page, /openCourse\(item\.course_id,item\.week_number\|\|undefined,item\)/);
 assert.match(page, /landingItem=\{courseLandingItem\}/);
 assert.match(page, /taskJump=\{taskJump\}/);
 assert.match(planner, /setHighlightedTask\(target\.id\)/);
 assert.match(planner, /const \[highlightedTask,setHighlightedTask\]=useState<string\|null>\(null\)/);
 assert.match(planner, /const highlightedRef=useRef<HTMLDivElement\|null>\(null\)/);
 assert.doesNotMatch(planner, /if\(target\)openEdit\(target\)/);
});

test('Calendar deadline-only items can be opened directly',()=>{
 assert.match(planner, /i\.due_date===selectedDay&&i\.planned_date!==selectedDay/);
 assert.match(planner, /aria-label=\{`Open task \$\{i\.title\}`\}/);
 assert.match(planner, /onClick=\{\(\)=>openEdit\(i\)\}/);
});

test('Home hero uses a standalone optimized panorama asset',()=>{
 assert.ok(existsSync(resolve(web,'public/studyhub-twilight.webp')));
 assert.match(styles, /url\('\/studyhub-twilight\.webp'\)/);
});

test('All views inherit warm dusk theme and shared background',()=>{
 assert.match(styles,/v0\.5 — Mulberry Dusk/);
 assert.match(styles,/\.app-shell \.main-area::before/);
 assert.match(styles,/\.app-shell \.home-day\.selected/);
 assert.match(styles,/\.home-inline-agenda-item/);
});
