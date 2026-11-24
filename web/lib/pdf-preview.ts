/** Controls overlapping PDF downloads without coupling them to unrelated saves.
 * Closing a reader invalidates all pending results; each new request aborts the old one.
 */
export function createPdfRequestGate() {
  let generation=0;
  let pending:AbortController|null=null;
  return {
    begin() {
      pending?.abort();
      const controller=new AbortController();
      pending=controller;
      return {requestId:++generation,controller};
    },
    isCurrent(requestId:number) {return requestId===generation;},
    release(requestId:number,controller:AbortController) {
      if(requestId===generation&&pending===controller)pending=null;
    },
    cancel() {
      ++generation;
      pending?.abort();
      pending=null;
    },
  };
}

export type CachedPdf = { blob: Blob; etag: string };

const MAX_CACHED_PDFS = 2;
const MAX_CACHED_BYTES = 64 * 1024 * 1024;
const PDF_CACHE_TTL_MS = 10 * 60 * 1000;

/** Tab-local bytes. A hit still requires the API to authorize and validate the file. */
export function createPdfSessionCache(now = Date.now) {
  const entries = new Map<string, CachedPdf & {
    expires: number;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let bytes = 0;

  const remove = (fileId: string) => {
    const entry = entries.get(fileId);
    if (!entry) return;
    clearTimeout(entry.timer);
    bytes -= entry.blob.size;
    entries.delete(fileId);
  };

  return {
    get(fileId: string): CachedPdf | undefined {
      const entry = entries.get(fileId);
      if (!entry) return;
      if (entry.expires <= now()) {
        remove(fileId);
        return;
      }
      return { blob: entry.blob, etag: entry.etag };
    },
    store(fileId: string, pdf: CachedPdf) {
      remove(fileId);
      if (pdf.blob.size > MAX_CACHED_BYTES || !pdf.blob.size) return;
      while (entries.size >= MAX_CACHED_PDFS || bytes + pdf.blob.size > MAX_CACHED_BYTES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        remove(oldest);
      }
      entries.set(fileId, {
        ...pdf,
        expires: now() + PDF_CACHE_TTL_MS,
        timer: setTimeout(() => remove(fileId), PDF_CACHE_TTL_MS),
      });
      bytes += pdf.blob.size;
    },
    remove,
    clear() {
      for (const fileId of entries.keys()) remove(fileId);
    },
  };
}
