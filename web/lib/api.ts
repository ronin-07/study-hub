import { type User } from 'firebase/auth';

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly requestId: string | null = null) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

// '/' means same-origin requests: Vercel Services routes /api/* to FastAPI.
const BASE = (process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '/' : 'http://127.0.0.1:8000')).replace(/\/$/, '');
export async function api<T>(route: string, user: User | null, options?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
  const token = user ? await user.getIdToken() : null;
  const controller = options?.timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options!.timeoutMs) : null;
  let res: Response;
  try {
    res = await fetch(BASE + route, {
    method: options?.method || 'GET',
    headers: { ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
    signal: controller?.signal
    });
  } finally { if (timer !== null) clearTimeout(timer); }
  if (!res.ok) {
    let details = `${res.status} ${res.statusText}`;
    try { const e = await res.json(); if (typeof e.detail === 'string') details = e.detail; } catch {}
    throw new ApiRequestError(details, res.status, res.headers.get('x-vercel-id') || res.headers.get('x-request-id'));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
export async function pdfBlob(route: string, user: User | null): Promise<string> {
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(BASE + route, { headers: token ? {Authorization: `Bearer ${token}`} : {} });
  if (!res.ok) throw new Error(`PDF retrieval failed (${res.status})`);
  const body = await res.blob();
  if (body.type !== 'application/pdf') throw new Error('Unexpected file type');
  return URL.createObjectURL(body);
}
