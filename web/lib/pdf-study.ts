import type { PdfPageMark } from './types';

export type StudyPdf = {
  key: string;
  fileId: string;
  url: string;
  title: string;
  page: number;
  zoom: string;
  bytes: number;
  resourceId?: string;
  courseId?: string;
  weekNumber?: number;
  marks: PdfPageMark[];
  marksStatus: 'idle' | 'loading' | 'ready' | 'error';
};
export type PdfSession<T extends StudyPdf = StudyPdf> = {
  tabs: T[];
  active: string | null;
  split: string | null;
  splitPercent: number;
  minimized: boolean;
};
export type PdfMarkChange = { page: number } & Partial<Pick<PdfPageMark, 'bookmarked' | 'note'>>;
export const maxPdfPage = 20000;
export const maxPdfTabs = 4;
export const maxPdfTabBytes = 100 * 1024 * 1024;
export const defaultPdfZoom = 'page-width';
export const minPdfZoom = .25;
export const maxPdfZoom = 4;

export function selectPdf<T extends StudyPdf>(session: PdfSession<T>, key: string): PdfSession<T> {
  return { ...session, minimized: false, active: key, split: session.split === key ? session.active : session.split };
}

export function placePdf<T extends StudyPdf>(session: PdfSession<T>, key: string, beside?: string): PdfSession<T> {
  if (beside && beside === session.active && beside !== key) return { ...session, split: key, minimized: false };
  return selectPdf(session, key);
}

export function removePdf<T extends StudyPdf>(session: PdfSession<T>, key: string): PdfSession<T> {
  const index = session.tabs.findIndex(tab => tab.key === key);
  if (index < 0) return session;
  const tabs = session.tabs.filter(tab => tab.key !== key);
  const active = session.active === key ? tabs[Math.min(index, tabs.length - 1)]?.key ?? null : session.active;
  return { ...session, tabs, active, split: session.split === key || session.split === active ? null : session.split };
}

export function applyPdfMark(marks: PdfPageMark[], change: PdfMarkChange): PdfPageMark[] {
  const old = marks.find(mark => mark.page === change.page) ?? { page: change.page, bookmarked: false, note: '' };
  const mark = { ...old, ...change };
  const next = marks.filter(entry => entry.page !== mark.page);
  if (mark.bookmarked || mark.note.trim()) next.push(mark);
  return next.sort((left, right) => left.page - right.page);
}

type LocalReading = { page: number; marks: PdfPageMark[] };
const emptyReading: LocalReading = { page: 1, marks: [] };
const storageKey = (owner: string, key: string) => `studyhub.pdf-reading.${encodeURIComponent(owner)}.${encodeURIComponent(key)}`;

const zoomKey = (owner: string, fileId: string) =>
  `studyhub.pdf-zoom.${encodeURIComponent(owner)}.${encodeURIComponent(fileId)}`;

export function normalizePdfZoom(value: string | null): string | null {
  if (value === 'page-width' || value === 'page-fit') return value;
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale < minPdfZoom || scale > maxPdfZoom) return null;
  return String(Math.round(scale * 100) / 100);
}

export function readPdfZoom(owner: string, fileId: string): string {
  try { return normalizePdfZoom(window.localStorage.getItem(zoomKey(owner, fileId))) ?? defaultPdfZoom; }
  catch { return defaultPdfZoom; }
}

export function savePdfZoom(owner: string, fileId: string, zoom: string) {
  try { window.localStorage.setItem(zoomKey(owner, fileId), zoom); }
  catch { /* The open tab can still remember its zoom. */ }
}

export function readLocalPdf(owner: string, key: string): LocalReading {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(owner, key)) || 'null') as Partial<LocalReading> | null;
    const page = value?.page ?? 1;
    return {
      page: Number.isInteger(page) && page >= 1 && page <= maxPdfPage ? page : 1,
      marks: Array.isArray(value?.marks) ? value.marks.filter(mark =>
        mark && Number.isInteger(mark.page) && mark.page >= 1 && mark.page <= maxPdfPage &&
        typeof mark.bookmarked === 'boolean' && typeof mark.note === 'string' && mark.note.length <= 1200).slice(0, 80) : [],
    };
  } catch { return emptyReading; }
}

export function writeLocalPdf(owner: string, key: string, change: Partial<LocalReading>) {
  window.localStorage.setItem(storageKey(owner, key), JSON.stringify({ ...readLocalPdf(owner, key), ...change }));
}

export function safePdfLink(url: string | null): string | null {
  if (!url) return null;
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(url).protocol) ? url : null;
  } catch { return null; }
}
