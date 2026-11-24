import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfSessionCache } from '../lib/pdf-preview.ts';
import { pdfBlob } from '../lib/api.ts';
import { driveLinksByFile, filterIndexedPdfs } from '../lib/resource-view.ts';

const validator = hex => '"sha256-' + hex.repeat(64) + '"';
const makePdf = (blob, hex = 'a') => ({ blob, etag: validator(hex) });
const pdf = new Blob(['%PDF-1.4\n'], { type: 'application/pdf' });

test('PDFs are evicted by count and last successful open', t => {
  const cache = createPdfSessionCache();
  t.after(() => cache.clear());
  cache.store('first', makePdf(pdf));
  cache.store('second', makePdf(pdf));
  cache.store('first', cache.get('first'));
  cache.store('third', makePdf(pdf));
  assert.equal(cache.get('second'), undefined);
  assert.equal(cache.get('first').blob, pdf);
  assert.equal(cache.get('third').blob, pdf);
});

test('the cache enforces the byte budget, expiry and a full session reset', t => {
  let now = 0;
  const cache = createPdfSessionCache(() => now);
  t.after(() => cache.clear());
  const large = new Blob([new Uint8Array(34 * 1024 * 1024)], { type: 'application/pdf' });
  cache.store('first', makePdf(large));
  cache.store('second', makePdf(large));
  assert.equal(cache.get('first'), undefined);
  assert.equal(cache.get('second').blob, large);
  now = 10 * 60 * 1000;
  assert.equal(cache.get('second'), undefined);
  cache.store('third', makePdf(pdf));
  cache.clear();
  assert.equal(cache.get('third'), undefined);
});

test('reopen sends Firebase authorization and reuses bytes only after a matching 304', async t => {
  const cached = makePdf(pdf);
  const fetch = t.mock.method(globalThis, 'fetch', async (_route, options) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get('authorization'), 'Bearer local-firebase-token');
    assert.equal(headers.get('if-none-match'), cached.etag);
    assert.equal(options.cache, 'no-store');
    return new Response(null, { status: 304, headers: { etag: cached.etag } });
  });
  const user = { getIdToken: async () => 'local-firebase-token' };
  assert.equal(await pdfBlob('/file.pdf', user, undefined, cached), cached);
  assert.equal(fetch.mock.callCount(), 1);
});

test('changed bytes replace the candidate and unverified responses stay uncached', async t => {
  const cached = makePdf(pdf);
  const next = new Blob(['%PDF-1.5\n'], { type: 'application/pdf' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(next, {
    headers: { etag: validator('b'), 'content-length': String(next.size) },
  }));
  const updated = await pdfBlob('/file.pdf', null, undefined, cached);
  assert.equal(updated.etag, validator('b'));
  assert.equal(await updated.blob.text(), await next.text());
  fetch.mock.mockImplementation(async () => new Response(next));
  assert.equal((await pdfBlob('/file.pdf', null, undefined, cached)).etag, null);
});

test('access denial, an unrelated 304 and cancellation cannot reuse cached bytes', async t => {
  const cached = makePdf(pdf);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  await assert.rejects(pdfBlob('/file.pdf', null, undefined, cached), { status: 403 });
  fetch.mock.mockImplementation(async () => new Response(null, { status: 304, headers: { etag: validator('b') } }));
  await assert.rejects(pdfBlob('/file.pdf', null, undefined, cached), { status: 304 });
  const controller = new AbortController();
  fetch.mock.mockImplementation(async () => {
    controller.abort();
    return new Response(null, { status: 304, headers: { etag: cached.etag } });
  });
  await assert.rejects(pdfBlob('/file.pdf', null, controller.signal, cached), { name: 'AbortError' });
});

test('the current workspace link immediately changes Resources filters after linking and unlinking', () => {
  const file = { id: 'pdf-1', name: 'Textbook', path: 'Course', links: [] };
  const resource = { id: 'link-1', source: 'drive', drive_file_id: 'pdf-1', course_id: 'course-1', week_number: null };
  const linked = { ...file, links: driveLinksByFile([resource]).get(file.id) ?? [] };
  assert.deepEqual(filterIndexedPdfs([linked], 'linked', ''), [linked]);
  const unlinked = { ...file, links: driveLinksByFile([]).get(file.id) ?? [] };
  assert.deepEqual(filterIndexedPdfs([unlinked], 'unlinked', ''), [unlinked]);
});
