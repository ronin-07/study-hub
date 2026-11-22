import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const component=read('components/photo-empty-state.tsx');
const css=read('app/globals.css');

test('photo, icon, text and CTA share a single accessible card surface',()=>{
  assert.match(component, /<section className=\{'photo-empty-state/);
  assert.match(component, /<div className="photo-empty-backdrop" aria-hidden="true"\/>/);
  assert.match(component, /<div className="photo-empty-content">/);
  assert.match(component, /<h3>\{title\}<\/h3>/);
  assert.match(component, /<p>\{detail\}<\/p>/);
  assert.match(component, /onClick=\{onAction\}/);
  assert.match(component, /onClick=\{onSecondary\}/);
  assert.doesNotMatch(component, /<Image|<img|next\/image|photo-empty-media/);
  assert.match(css, /\.photo-empty-state\{[^}]*position:relative;isolation:isolate/s);
  assert.match(css, /\.photo-empty-backdrop\{[^}]*position:absolute;inset:0;z-index:0/s);
  assert.match(css, /\.photo-empty-content\{[^}]*position:relative;z-index:1/s);
});

test('every scene image has an exact directly-served public path and a gradient fallback',()=>{
  for(const scene of ['home','study','tasks','calendar','resources']){
    const file=new URL(`../public/empty-states/${scene}.webp`,import.meta.url);
    const bytes=readFileSync(file);
    assert.equal(bytes.toString('ascii',0,4),'RIFF');
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.ok(statSync(file).size>1000);
    assert.match(css,new RegExp(`\\.photo-empty-${scene} \\.photo-empty-backdrop\\{background-image:linear-gradient\\([\\s\\S]*?\\),url\\('/empty-states/${scene}\\.webp'\\)\\}`));
  }
  assert.match(css,/\.photo-empty-backdrop\{[^}]*background-color:#453046/s);
  assert.doesNotMatch(component, /_next\/image|<Image|next\/image/);
});

test('compact cards, reduced motion and the course menu remain intact',()=>{
  assert.match(css,/\.photo-empty-state\.compact\{max-width:none;min-height:/);
  assert.match(css,/@media\(max-width:650px\)\{\.photo-empty-state/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.photo-empty-actions button/);
  assert.match(css,/\.home-course-menu\{position:fixed/);
});
