import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url),'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url),'utf8');
const review = readFileSync(new URL('../components/focus-duration-fields.tsx', import.meta.url),'utf8');
const pdf = readFileSync(new URL('../components/pdf-workspace.tsx', import.meta.url),'utf8');

test('Focus paused and running labels differ; presets are replaced while a timer exists',()=>{
  assert.match(page,/active\.status==='paused'\?'Paused':'Focusing'/);
  assert.match(page,/active\?<div className="focus-target-summary"/);
  assert.doesNotMatch(page,/<Badge tone="good">Active session<\/Badge>/);
  assert.match(page,/<FocusDial session=\{active\} anchor=\{focusClock\}\/>/);
});
test('Focus review keeps exact backend limit and zero-time discard behavior',()=>{
  assert.match(page,/<FocusDurationFields seconds=\{finishSeconds\} maximum=\{reviewLimit\} onChange=\{setFinishSeconds\}\/>/);
  assert.match(review,/setFocusDurationPart\(total,part,e\.target\.value,maximum\)/);
  assert.match(page,/if\(confirmed===0\)\{void discardEmptyFocus\(active\.id\);return;\}/);
  assert.match(page,/confirmed_seconds:confirmed/);
});
test('Focus statistics and recent sessions use adaptive display; target remains local',()=>{
  assert.match(page,/formatFocusDuration\(weekSeconds\)/);
  assert.match(page,/formatFocusDuration\(totalSeconds\)/);
  assert.match(page,/formatFocusDuration\(s\.focus_seconds\|\|0\)/);
  assert.match(page,/localStorage\.setItem\('studyhub-focus-goal'/);
});
test('Resources selects by immutable file ID and links only the selected document',()=>{
  assert.match(page,/setSelectedPdfId\(entry\.id\)/);
  assert.match(page,/setLinkCourse\(intended\?\.paperId\?intended\.courseId:suggestion\?\.course_id\|\|intended\?\.courseId\|\|'\'\)/);
  assert.match(page,/selectedPdfId!==file\.id\|\|resourceLinks\.has\(file\.id\)\)return/);
  assert.match(page,/onClick=\{\(\)=>linkDriveFile\(selectedPdf\)\}/);
  assert.match(page,/Nothing is linked automatically/);
  assert.match(page,/resourceLinks\.has\(selectedPdf\.id\)/);
  assert.match(page,/linkIntentRef\.current=\{courseId:id,week,kind,scope,paperId\}/);
  assert.match(page,/driveLinksByFile\(data\.resources\)/);
});
test('Resource browsing has query, status filters, sticky editor and no silent auto linking',()=>{
  assert.match(page,/filterIndexedPdfs\(driveIndex,indexFilter,indexSearch\)/);
  for(const label of ['Unlinked','Suggested','Linked','All files'])assert.ok(page.includes(`>${label}</option>`));
  assert.match(css,/\.resources-link-card\{position:sticky/);
  assert.match(page,/aria-label="Search indexed PDFs"/);
  assert.match(page,/onClick=\{\(\)=>choosePdf\(f\)\}/);
});
test('PDF viewer keeps saved-page navigation and native reader controls without duplicate zoom',()=>{
  assert.match(pdf,/Bookmarked PDF page/);
  assert.match(pdf,/Chrome's PDF toolbar handles zoom, search and print/);
  assert.doesNotMatch(pdf,/Increase zoom|Decrease zoom/);
  assert.match(pdf,/onPage\(pdf\.page\+1\)/);
  assert.match(pdf,/onClose/);
});
