import { type User } from 'firebase/auth';

// '/' means same-origin requests: Vercel Services routes /api/* to FastAPI.
const BASE = (process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '/' : 'http://127.0.0.1:8000')).replace(/\/$/, '');
export async function api<T>(route: string, user: User | null, options?: { method?: string; body?: unknown }): Promise<T> {
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(BASE + route, {
    method: options?.method || 'GET',
    headers: { ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store'
  });
  if (!res.ok) { let details = `${res.status} ${res.statusText}`; try { const e = await res.json(); if (typeof e.detail === 'string') details = e.detail; } catch {} throw new Error(details); }
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
