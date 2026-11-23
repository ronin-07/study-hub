import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const read=(path)=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const page=read('../app/page.tsx');
const reader=read('../components/pdf-workspace.tsx');
const api=read('../lib/api.ts');
const css=read('../app/globals.css');
const profile=read('../components/profile-name.tsx');
const require=createRequire(import.meta.url);
// Node strips TypeScript from the pure request coordinator, matching other project tests.
const {createPdfRequestGate}=require('../lib/pdf-preview.ts');

test('PDF request gate aborts the older request, and only the latest selection may win',()=>{
  const gate=createPdfRequestGate();
  const first=gate.begin();
  assert.equal(gate.isCurrent(first.requestId),true);
  const second=gate.begin();
  assert.equal(first.controller.signal.aborted,true);
  assert.equal(gate.isCurrent(first.requestId),false);
  assert.equal(gate.isCurrent(second.requestId),true);
  gate.release(first.requestId,first.controller);
  assert.equal(gate.isCurrent(second.requestId),true);
  gate.cancel();
  assert.equal(second.controller.signal.aborted,true);
  assert.equal(gate.isCurrent(second.requestId),false);
});

test('open starts loading immediately, avoids duplicate fetches and releases unused blob URLs',()=>{
  assert.match(page,/pdfPendingFileRef\.current===fileId\)return/);
  assert.match(page,/setPdfOpening\(\{requestId,fileId,title,resourceId,page,status:'loading'\}\)/);
  assert.match(page,/pdfBlob\(`\/api\/drive\/files\/\$\{encodeURIComponent\(fileId\)\}\/pdf`,user,controller\.signal\)/);
  assert.match(page,/if\(controller\.signal\.aborted\|\|!pdfRequestGateRef\.current\.isCurrent\(requestId\)\)\{URL\.revokeObjectURL\(url\);return;\}/);
  assert.match(page,/PDF_FETCH_TIMEOUT_MS/);
  assert.match(api,/signal\?: AbortSignal/);
  assert.match(api,/cache: 'no-store', signal/);
});

test('PDF load failure has retry, cancel, file identity and no fake percentage',()=>{
  assert.match(reader,/aria-label=\{`Opening \$\{title\}`\}/);
  assert.match(reader,/className="pdf-opening-filename"/);
  assert.match(reader,/onClick=\{onCancel\}/);
  assert.match(reader,/onClick=\{onRetry\}/);
  assert.match(reader,/20[0]{3}/);
  assert.doesNotMatch(reader,/\d+% complete/);
});

test('reader uses native PDF for hyperlinks and zoom, with explicit saved-page control',()=>{
  assert.match(reader,/pdf\.url}#page=\$\{pdf\.page\}/);
  assert.match(reader,/Bookmarked PDF page/);
  assert.match(reader,/Set a saved page above to return to it later/);
  assert.match(reader,/Hide Study Mode sidebar/);
  assert.match(reader,/onLoad=\{\(\)=>/);
  assert.match(reader,/Retry viewer/);
  assert.doesNotMatch(reader,/zoom=\$\{zoom\}/);
});

test('profile tooltip uses a viewport-clamped portal and branding stays readable',()=>{
  assert.match(profile,/createPortal/);
  assert.match(profile,/Math\.max\(12,window\.innerWidth-332\)/);
  assert.match(profile,/onPointerEnter=\{show\}/);
  assert.match(profile,/onFocus=\{show\}/);
  assert.match(css,/\.sidebar-profile-tooltip/);
  assert.match(css,/\.sidebar-collapse-button\{flex:0 0 40px/);
});

test('Focus and Resources text-entry focus ring uses one sage-green outline',()=>{
  assert.match(css,/\.app-shell \.focus-duration-fields label:focus-within\{[\s\S]*?border-color:#9ed3b2/);
  assert.match(css,/\.app-shell \.resources-search:focus-within\{[\s\S]*?border-color:#9ed3b2/);
  assert.match(css,/\.app-shell \.resources-search :is\(input:focus,input:focus-visible\)/);
});
