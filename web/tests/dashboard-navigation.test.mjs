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

test('Home date clicks select the corresponding day and agenda',()=>{
 assert.match(page, /onClick=\{\(\)=>openCalendarDate\(day\.date\)\}/);
 assert.match(page, /onClick=\{\(\)=>openCalendarDate\(today\)\}/);
 assert.match(planner, /selectCalendarDay\(calendarJump\.date\)/);
});

test('Home deadline links open the exact task edit dialog',()=>{
 assert.match(page, /onClick=\{\(\)=>openTaskDetails\(i\.id\)\}/);
 assert.match(page, /taskJump=\{taskJump\}/);
 assert.match(planner, /items\.find\(i=>i\.id===taskJump\.id\)/);
 assert.match(planner, /if\(target\)openEdit\(target\)/);
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
