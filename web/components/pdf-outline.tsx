'use client';

import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { safePdfLink } from '@/lib/pdf-study';

export type PdfDestination = string | unknown[];
type Entry = { title: string; dest: PdfDestination | null; url: string | null; items: Entry[] };

function Entries({ entries, onJump }: { entries: Entry[]; onJump: (dest: PdfDestination) => void }) {
  const [limit, setLimit] = useState(100);
  return <>
    <ul>{entries.slice(0, limit).map((entry, index) => <li key={index}><OutlineEntry entry={entry} onJump={onJump}/></li>)}</ul>
    {entries.length > limit && <button type="button" className="btn secondary small" onClick={() => setLimit(value => value + 100)}>Show more sections</button>}
  </>;
}

function OutlineEntry({ entry, onJump }: { entry: Entry; onJump: (dest: PdfDestination) => void }) {
  const [expanded, setExpanded] = useState(false);
  const destination = entry.dest;
  const href = safePdfLink(entry.url);
  const title = entry.title.trim() || 'Untitled section';
  return <>
    <div className="pdfjs-outline-row">
      {!!entry.items.length && <button type="button" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
        className="btn secondary small pdfjs-outline-expand" onClick={() => setExpanded(!expanded)}>{expanded ? '−' : '+'}</button>}
      {href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{title}</a>
        : destination !== null ? <button type="button" className="pdfjs-outline-jump" onClick={() => onJump(destination)}>{title}</button>
        : <span>{title}</span>}
    </div>
    {expanded && <Entries entries={entry.items} onJump={onJump}/>}
  </>;
}

export function PdfOutline({ pdf, onJump }: { pdf: PDFDocumentProxy; onJump: (dest: PdfDestination) => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void pdf.getOutline().then(outline => { if (active) setEntries(outline ?? []); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [pdf]);
  return <nav className="pdfjs-outline" aria-label="Document outline">
    {failed ? <p role="status">The outline couldn’t be loaded.</p>
      : entries === null ? <p role="status">Loading outline…</p>
      : entries.length ? <Entries entries={entries} onJump={onJump}/>
      : <p>This PDF has no embedded outline.</p>}
  </nav>;
}
