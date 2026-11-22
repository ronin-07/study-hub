import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const component=readFileSync(new URL('../components/course-planner.tsx', import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css', import.meta.url),'utf8');
test('Teaching week uses one accessible native select and one Lucide chevron',()=>{
  assert.match(component,/className="planner-week-select-wrap"/);
  assert.match(component,/<select aria-label="Teaching week"/);
  assert.match(component,/<ChevronDown size=\{16\} strokeWidth=\{2\} aria-hidden="true" className="planner-week-select-chevron"/);
  assert.match(css,/planner-week-select-wrap select\{[^}]*appearance:none/);
  assert.match(css,/planner-week-select-chevron\{[^}]*pointer-events:none/);
});
