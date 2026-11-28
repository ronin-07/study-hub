'use client';

import { useState } from 'react';
import type { PdfPageMark } from '@/lib/types';
import { maxPdfPage, type PdfMarkChange } from '@/lib/pdf-study';

export function PdfMarks({ page, pages, marks, onJump, onChange }: {
  page: number; pages: number; marks: PdfPageMark[]; onJump: (page: number) => void;
  onChange: (change: PdfMarkChange) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ page: number; note: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const current = marks.find(mark => mark.page === page);
  const allowMark = page <= maxPdfPage;
  async function save(change: PdfMarkChange) {
    setPending(true);
    setError('');
    try {
      await onChange(change);
      if (change.note !== undefined) setEditing(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this mark.');
    } finally {
      setPending(false);
    }
  }
  return <aside className="pdfjs-marks" aria-label="Bookmarks and page notes">
    <div className="pdfjs-mark-controls">
      <button type="button" className="btn secondary small" disabled={pending || !allowMark}
        onClick={() => void save({ page, bookmarked: !current?.bookmarked })}>{current?.bookmarked ? 'Remove bookmark' : 'Bookmark page'}</button>
      <button type="button" className="btn secondary small" disabled={pending || !allowMark || !!editing}
        onClick={() => { setError('');setEditing({ page, note: current?.note ?? '' }); }}>{current?.note ? 'Edit note' : 'Add page note'}</button>
    </div>
    {editing && <form onSubmit={event => { event.preventDefault();void save({ page: editing.page, note: editing.note.trim() }); }}>
      <label>Note for page {editing.page}
        <textarea value={editing.note} maxLength={1200} rows={4} disabled={pending}
          onChange={event => setEditing({ ...editing, note: event.target.value })}/>
      </label>
      <div className="pdfjs-mark-controls">
        <button type="submit" className="btn secondary small" disabled={pending}>Save note</button>
        <button type="button" className="btn secondary small" disabled={pending} onClick={() => setEditing(null)}>Cancel</button>
        {!!marks.find(mark => mark.page === editing.page)?.note && <button type="button" className="btn secondary small"
          disabled={pending} onClick={() => void save({ page: editing.page, note: '' })}>Delete note</button>}
      </div>
    </form>}
    {error && <p role="alert">{error}</p>}
    {marks.length ? <ul>{marks.map(mark => <li key={mark.page}>
      <button type="button" className="btn secondary small" disabled={mark.page > pages} onClick={() => onJump(mark.page)}>
        Page {mark.page}{mark.bookmarked ? ' · Bookmark' : ''}
      </button>
      {mark.note && <p>{mark.note}</p>}
    </li>)}</ul> : <p>No bookmarks or notes yet.</p>}
  </aside>;
}
