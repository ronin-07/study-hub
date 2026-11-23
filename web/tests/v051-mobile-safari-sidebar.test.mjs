import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
const layout=readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8');

test('Safari can extend the web theme into safe areas and overscroll',()=>{
  assert.match(layout,/viewportFit: 'cover'/);
  assert.match(layout,/themeColor: '#211a28'/);
  assert.match(page,/document\.documentElement\.dataset\.studyHubTheme=theme/);
  assert.match(page,/querySelector\('meta\[name="theme-color"\]'\)/);
  assert.match(css,/html\[data-study-hub-theme="dark"\]\{color-scheme:dark\}/);
  assert.match(css,/html\[data-study-hub-theme="light"\],html\[data-study-hub-theme="light"\] body\{background-color:#f7f8fc\}/);
});

test('mobile header stays in normal flow and removes the duplicate iPhone clock',()=>{
  assert.match(page,/className="mobile-topbar-brand"/);
  assert.match(css,/\.app-shell \.main-area>\.topbar\.dashboard-topbar\{position:relative;/);
  assert.match(css,/\.app-shell \.main-area>\.topbar \.topbar-datetime\{display:none\}/);
  assert.match(css,/\.dashboard-page\{padding-top:20px\}/);
  assert.match(css,/\.app-shell \.sidebar\{display:none\}/);
  assert.match(page,/className="mobile-nav"/);
});

test('desktop sidebar can collapse, expand, resize and restore saved preferences',()=>{
  assert.match(page,/studyhub-sidebar-collapsed/);
  assert.match(page,/studyhub-sidebar-width/);
  assert.match(page,/sidebarCollapsed\?'Expand sidebar':'Collapse sidebar'/);
  assert.match(page,/role="separator" aria-label="Resize sidebar"/);
  assert.match(page,/onPointerDown=\{onSidebarPointerDown\}/);
  assert.match(page,/onKeyDown=\{onSidebarResizeKey\}/);
  assert.match(page,/onDoubleClick=\{\(\)=>saveSidebarWidth\(null\)\}/);
  assert.match(page,/Math\.max\(205,Math\.min\(340/);
  assert.match(css,/\.app-shell \.sidebar\.is-collapsed\{width:76px/);
  assert.match(css,/\.sidebar\.is-collapsed \.nav-text/);
  assert.match(page,/incomplete tasks`:t\.label/);
});
