import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPdfMark, normalizePdfZoom, placePdf, readPdfZoom, removePdf, safePdfLink, savePdfZoom, selectPdf, setPdfSplit } from '../lib/pdf-study.ts';

test('a bookmark and note share a page without replacing each other', () => {
  const marks = applyPdfMark([], { page: 3, bookmarked: true });
  const noted = applyPdfMark(marks, { page: 3, note: 'Check derivation' });
  const another = applyPdfMark(noted, { page: 1, bookmarked: true });
  assert.deepEqual(another.map(mark => mark.page), [1, 3]);
  assert.deepEqual(another[1], { page: 3, bookmarked: true, note: 'Check derivation' });
  assert.deepEqual(applyPdfMark(noted, { page: 3, bookmarked: false, note: '' }), []);
  assert.notEqual(marks, noted);
});

test('selecting the other split document preserves pane order and closing selects a neighbor', () => {
  const state = { tabs: [{ key: 'paper' }, { key: 'solution' }, { key: 'textbook' }], active: 'paper', split: 'solution', splitFirst: 'paper', minimized: true };
  const selected = selectPdf(state, 'solution');
  assert.deepEqual([selected.active, selected.split, selected.splitFirst, selected.minimized], ['solution', 'paper', 'paper', false]);
  assert.equal(setPdfSplit(selected, 'textbook').splitFirst, 'textbook');
  assert.equal(selectPdf(state, 'textbook').splitFirst, 'textbook');
  const closed = removePdf(selected, 'solution');
  assert.deepEqual([closed.active, closed.split], ['textbook', 'paper']);
  assert.equal(removePdf(closed, 'paper').split, null);
});

test('document links allow ordinary destinations and reject active schemes', () => {
  assert.equal(safePdfLink('https://example.test/section#page=3'), 'https://example.test/section#page=3');
  assert.equal(safePdfLink('mailto:example@example.test'), 'mailto:example@example.test');
  for (const url of ['javascript:alert(1)', 'data:text/plain,hi', 'file:///C:/test.pdf', '//example.test', null]) {
    assert.equal(safePdfLink(url), null);
  }
});

test('open beside keeps the original PDF active and avoids selecting the same PDF twice', () => {
  const tabs = [{ key: 'exam' }, { key: 'solution' }];
  const session = { tabs, active: 'exam', split: null, splitFirst: null, minimized: false };
  assert.deepEqual(placePdf(session, 'solution', 'exam'), { ...session, split: 'solution', splitFirst: 'exam' });
  assert.deepEqual(placePdf(session, 'solution', 'missing'), { ...session, active: 'solution' });
  assert.equal(placePdf(session, 'exam', 'exam').split, null);
});

test('zoom is stored by account and Drive PDF and restores both presets and numeric scales', t => {
  const values = new Map();
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  assert.equal(readPdfZoom('owner', 'slides'), 'page-width');
  savePdfZoom('owner', 'slides', 'page-fit');
  savePdfZoom('owner', 'book', '1.50001');
  assert.equal(readPdfZoom('owner', 'slides'), 'page-fit');
  assert.equal(readPdfZoom('owner', 'book'), '1.5');
  assert.equal(readPdfZoom('someone-else', 'slides'), 'page-width');
  assert.equal(normalizePdfZoom('5'), null);
});
