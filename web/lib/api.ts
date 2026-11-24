import type { User } from 'firebase/auth';
import type { CachedPdf } from './pdf-preview';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly requestId: string | null;

  constructor(message: string, status: number, requestId: string | null = null) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.requestId = requestId;
  }
}

// '/' means same-origin requests: Vercel Services routes /api/* to FastAPI.
const BASE = (process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '/' : 'http://127.0.0.1:8000')).replace(/\/$/, '');
export async function api<T>(route: string, user: User | null, options?: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
  const token = user ? await user.getIdToken() : null;
  const controller = options?.timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options!.timeoutMs) : null;
  const externalSignal = options?.signal;
  const abort = () => controller?.abort(externalSignal?.reason);
  if (controller && externalSignal?.aborted) abort();
  if (controller) externalSignal?.addEventListener('abort', abort, { once: true });
  try {
    const res = await fetch(BASE + route, {
      method: options?.method || 'GET',
      headers: { ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: controller?.signal ?? externalSignal,
    });
    // The timeout covers the response headers. Keep external cancellation
    // connected through body reading when a refresh has been superseded.
    if (timer !== null) clearTimeout(timer);
    if (!res.ok) {
      let details = `${res.status} ${res.statusText}`;
      try { const e = await res.json(); if (typeof e.detail === 'string') details = e.detail; } catch {}
      throw new ApiRequestError(details, res.status, res.headers.get('x-vercel-id') || res.headers.get('x-request-id'));
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (controller) externalSignal?.removeEventListener('abort', abort);
  }
}
/** Authorize the PDF even when a validated copy may already be in memory. */
export async function pdfBlob(route: string, user: User | null, signal?: AbortSignal, cached?: CachedPdf): Promise<{ blob: Blob; etag: string | null }> {
  const token = user ? await user.getIdToken() : null;
  signal?.throwIfAborted();
  const res = await fetch(BASE + route, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cached ? { 'If-None-Match': cached.etag } : {}),
    },
    cache: 'no-store', signal,
  });
  signal?.throwIfAborted();
  const etag = res.headers.get('etag');
  if (res.status === 304 && cached && etag === cached.etag) return cached;
  if (!res.ok) throw new ApiRequestError(`PDF retrieval failed (${res.status})`, res.status);
  const body = await res.blob();
  signal?.throwIfAborted();
  if (!body.type.toLowerCase().startsWith('application/pdf')) throw new Error('Unexpected file type');
  const verified = etag && /^"sha256-[a-f0-9]{64}"$/.test(etag) && Number(res.headers.get('content-length')) === body.size;
  return { blob: body, etag: verified ? etag : null };
}
