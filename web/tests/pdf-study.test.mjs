import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPdfMark, removePdf, safePdfLink, selectPdf } from '../lib/pdf-study.ts';

test('a bookmark and note share a page without replacing each other', () => {
  const marks = applyPdfMark([], { page: 3, bookmarked: true });
  const noted = applyPdfMark(marks, { page: 3, note: 'Check derivation' });
  const another = applyPdfMark(noted, { page: 1, bookmarked: true });
  assert.deepEqual(another.map(mark => mark.page), [1, 3]);
  assert.deepEqual(another[1], { page: 3, bookmarked: true, note: 'Check derivation' });
  assert.deepEqual(applyPdfMark(noted, { page: 3, bookmarked: false, note: '' }), []);
  assert.notEqual(marks, noted);
});

test('selecting a split document swaps panes and closing a tab selects a neighbor', () => {
  const state = { tabs: [{ key: 'paper' }, { key: 'solution' }, { key: 'textbook' }], active: 'paper', split: 'solution', minimized: true };
  const swapped = selectPdf(state, 'solution');
  assert.deepEqual([swapped.active, swapped.split, swapped.minimized], ['solution', 'paper', false]);
  const closed = removePdf(swapped, 'solution');
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
