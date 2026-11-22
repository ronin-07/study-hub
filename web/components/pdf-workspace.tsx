'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ExternalLink, Maximize2, Minimize2, Timer, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Item, Resource } from '@/lib/types';
import { Badge } from './common';

type Pdf = { url: string; title: string; page: number; resourceId?: string; courseId?: string; weekNumber?: number };
type Props = {
  pdf: Pdf; items: Item[]; related: Resource[];
  onClose: () => void; onPage: (page: number) => void;
  onOpenResource: (resource: Resource) => void;
  onToggleItem: (item: Item) => void; onFocus: (item?: Item) => void;
};

/** Native browser PDF iframe: searchable when the browser's PDF reader supports it.
 * Page number is an explicit, persistent bookmark, not an automatically tracked scroll position.
 */
export function PdfWorkspace({ pdf, items, related, onClose, onPage, onOpenResource, onToggleItem, onFocus }: Props) {
  const [draft, setDraft] = useState(String(pdf.page));
  const [zoom, setZoom] = useState(100);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setDraft(String(pdf.page)), [pdf.page]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  const savePage = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(String(pdf.page)); return; }
    onPage(Math.max(1, Math.min(20000, Math.floor(n))));
  };
  const sameWeekItems = items.filter(item => item.course_id === pdf.courseId && item.week_number === pdf.weekNumber);
  return <div className={'pdf-overlay pdf-workspace ' + (expanded ? 'pdf-expanded' : '')} role="dialog" aria-modal="true" aria-label={`Reading ${pdf.title}`}>
    <div className="pdf-topbar">
      <div className="pdf-file-title"><BookOpen size={18}/><strong title={pdf.title}>{pdf.title}</strong><span>Read in Study Hub</span></div>
      <div className="pdf-actions">
        <button type="button" className="btn secondary small" title="Previous page" disabled={pdf.page <= 1} onClick={() => onPage(pdf.page - 1)}><ArrowLeft size={15}/></button>
        <label>Bookmark <input aria-label="Bookmarked PDF page" type="number" min={1} max={20000} value={draft} onChange={e => setDraft(e.target.value)} onBlur={savePage} onKeyDown={e => { if (e.key === 'Enter') savePage(); }}/></label>
        <button type="button" className="btn secondary small" title="Next page" onClick={() => onPage(pdf.page + 1)}><ArrowRight size={15}/></button>
        <button type="button" className="btn secondary small" title="Decrease zoom" disabled={zoom <= 50} onClick={() => setZoom(z => Math.max(50, z - 25))}><ZoomOut size={15}/></button>
        <span className="pdf-zoom-label">{zoom}%</span>
        <button type="button" className="btn secondary small" title="Increase zoom" disabled={zoom >= 200} onClick={() => setZoom(z => Math.min(200, z + 25))}><ZoomIn size={15}/></button>
        <button type="button" className="btn secondary small" title={expanded ? 'Show study sidebar' : 'Expand PDF'} onClick={() => setExpanded(x => !x)}>{expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</button>
        <button type="button" className="btn secondary small" onClick={onClose}><X size={16}/> Close</button>
      </div>
    </div>
    <div className="pdf-reading-layout">
      <div className="pdf-document-panel">
        <p className="pdf-guidance">The bookmark is saved when you use the page control. Native PDF scrolling is not tracked; use the browser PDF toolbar for search and print.</p>
        <div className="pdf-document-scroll"><iframe key={`${pdf.url}-${pdf.page}-${zoom}`} title={pdf.title} src={`${pdf.url}#page=${pdf.page}&zoom=${zoom}`} className="pdf-frame"/></div>
      </div>
      {!expanded && <aside className="pdf-study-side" aria-label="Study activity sidebar">
        <div className="pdf-side-block"><span className="eyebrow">STUDY MODE</span><h3>Keep your place</h3><p>Read slides or Goodnotes PDFs while checking off your work.</p><button type="button" className="btn primary full" onClick={() => onFocus(sameWeekItems.find(i => !i.done))}><Timer size={16}/> Start focus</button></div>
        <div className="pdf-side-block"><h3>Week checklist</h3>{sameWeekItems.length ? sameWeekItems.map(i => <label className="pdf-check" key={i.id}><input type="checkbox" checked={i.done} onChange={() => onToggleItem(i)}/><span>{i.title}</span></label>) : <p className="muted">Link this PDF to a course week to see its tasks.</p>}</div>
        <div className="pdf-side-block"><h3>Other materials</h3>{related.filter(r => r.id !== pdf.resourceId).map(r => <button type="button" className="pdf-related" key={r.id} onClick={() => onOpenResource(r)}><span>{r.title}</span><Badge>{r.kind}</Badge>{r.source === 'drive' ? <BookOpen size={13}/> : <ExternalLink size={13}/>}</button>)}{related.length < 2 && <p className="muted">Add an original slide PDF or Goodnotes annotated copy to switch between them here.</p>}</div>
      </aside>}
    </div>
  </div>;
}
