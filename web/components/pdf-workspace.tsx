'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, FileText, LoaderCircle, PanelRightClose, PanelRightOpen, RotateCcw, Timer, X } from 'lucide-react';
import type { Item, Resource } from '@/lib/types';
import { Badge } from './common';

type Pdf = { url: string; title: string; page: number; resourceId?: string; courseId?: string; weekNumber?: number };
type Props = {
  pdf: Pdf; items: Item[]; related: Resource[]; pendingItems: ReadonlySet<string>; completingIds: ReadonlySet<string>;
  onClose: () => void; onPage: (page: number) => void;
  onOpenResource: (resource: Resource) => void;
  onToggleItem: (item: Item) => void; onFocus: (item?: Item) => void;
};
/** Native browser PDF iframe: preserves PDF annotations/links in original PDFs.
 * The saved page is explicit; native PDF scrolling is not accessible across the iframe.
 */
export function PdfWorkspace({ pdf, items, related, pendingItems, completingIds, onClose, onPage, onOpenResource, onToggleItem, onFocus }: Props) {
  const [draft,setDraft] = useState(String(pdf.page));
  const [studyOpen,setStudyOpen] = useState(true);
  const [frameReady,setFrameReady] = useState(false);
  const [frameSlow,setFrameSlow] = useState(false);
  const [frameError,setFrameError] = useState(false);
  const [frameRevision,setFrameRevision] = useState(0);
  useEffect(()=>setDraft(String(pdf.page)),[pdf.page]);
  useEffect(()=>{
    if(window.matchMedia('(max-width: 690px)').matches)setStudyOpen(false);
  },[]);
  useEffect(()=>{
    // The onLoad event can be quicker than a passive effect for small documents.
    // Do not reset an already-ready frame after onLoad.
    setFrameSlow(false);setFrameError(false);
    if(frameReady)return;
    const timer=window.setTimeout(()=>setFrameSlow(true),20000);
    return ()=>window.clearTimeout(timer);
  },[pdf.url,frameRevision,frameReady]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    document.addEventListener('keydown',handler);
    return ()=>document.removeEventListener('keydown',handler);
  },[onClose]);
  const savePage=()=>{
    const page=Number(draft);
    if(!Number.isFinite(page)){setDraft(String(pdf.page));return;}
    onPage(Math.max(1,Math.min(20000,Math.floor(page))));
  };
  const sameWeekItems=items.filter(item=>item.course_id===pdf.courseId&&item.week_number===pdf.weekNumber);
  return <div className={'pdf-overlay pdf-workspace'+(studyOpen?'':' pdf-expanded')} role="dialog" aria-modal="true" aria-label={`Reading ${pdf.title}`}>
    <div className="pdf-topbar">
      <div className="pdf-file-title"><BookOpen size={18}/><strong title={pdf.title}>{pdf.title}</strong><span title="Choose a page to save your bookmark. Chrome's PDF toolbar handles zoom, search and print.">Study Hub reader</span></div>
      <div className="pdf-actions">
        <button type="button" className="btn secondary small" title="Previous bookmarked page" aria-label="Previous bookmarked page" disabled={pdf.page<=1} onClick={()=>onPage(pdf.page-1)}><ArrowLeft size={15}/></button>
        <label>Saved page <input aria-label="Bookmarked PDF page" type="number" min={1} max={20000} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={savePage} onKeyDown={e=>{if(e.key==='Enter'){savePage();e.currentTarget.blur();}}}/></label>
        <button type="button" className="btn secondary small" title="Next bookmarked page" aria-label="Next bookmarked page" onClick={()=>onPage(pdf.page+1)}><ArrowRight size={15}/></button>
        <button type="button" className="btn secondary small pdf-toggle-study" title={studyOpen?'Hide Study Mode':'Show Study Mode'} aria-label={studyOpen?'Hide Study Mode sidebar':'Show Study Mode sidebar'} aria-expanded={studyOpen} onClick={()=>setStudyOpen(value=>!value)}>{studyOpen?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}<span>Study Mode</span></button>
        <button type="button" className="btn secondary small" onClick={onClose}><X size={16}/> Close</button>
      </div>
    </div>
    <div className="pdf-reading-layout">
      <div className="pdf-document-panel">
        <div className="pdf-document-scroll">
          <div className="pdf-frame-wrap">
            <iframe key={`${pdf.url}-${pdf.page}-${frameRevision}`} title={pdf.title} src={`${pdf.url}#page=${pdf.page}`} className="pdf-frame"
              onLoad={()=>{setFrameReady(true);setFrameError(false);}} onError={()=>{setFrameError(true);setFrameReady(false);}}/>
            {!frameReady&&<div className="pdf-frame-loading" role="status" aria-live="polite">
              {frameError?<FileText size={28}/>:<LoaderCircle size={28} className="spin"/>}
              <strong>{frameError?'Could not display this PDF':'Preparing your PDF viewer'}</strong>
              <p>{frameError?'You can try loading the document again.':frameSlow?'The browser is still preparing this document. You can retry or close.':'The PDF is downloaded. Starting the browser reader…'}</p>
              <div className="pdf-frame-loading-actions"><button type="button" className="btn secondary small" onClick={()=>{setFrameReady(false);setFrameSlow(false);setFrameError(false);setFrameRevision(value=>value+1);}}><RotateCcw size={15}/> Retry viewer</button><button type="button" className="btn secondary small" onClick={onClose}>Close</button></div>
            </div>}
          </div>
        </div>
      </div>
      {studyOpen&&<aside className="pdf-study-side" aria-label="Study activity sidebar">
        <div className="pdf-side-block"><span className="eyebrow">STUDY MODE</span><h3>Keep your place</h3><p>Use Chrome's PDF toolbar for search, print and zoom. Set a saved page above to return to it later.</p><button type="button" className="btn primary full" onClick={()=>onFocus(sameWeekItems.find(i=>!i.done))}><Timer size={16}/> Start focus</button></div>
        <div className="pdf-side-block"><h3>Week checklist</h3>{sameWeekItems.length?sameWeekItems.map(i=><label className={'pdf-check task-completion-row'+(completingIds.has(i.id)?' is-completing':'')} key={i.id}><input type="checkbox" className="task-completion-check" checked={i.done||completingIds.has(i.id)} disabled={pendingItems.has(i.id)||completingIds.has(i.id)} onChange={()=>onToggleItem(i)}/><span>{i.title}</span></label>):<p className="muted">Link this PDF to a course week to see its tasks.</p>}</div>
        <div className="pdf-side-block"><h3>Other materials</h3>{related.filter(r=>r.id!==pdf.resourceId).map(r=><button type="button" className="pdf-related" key={r.id} onClick={()=>onOpenResource(r)}><span>{r.title}</span><Badge>{r.kind}</Badge>{r.source==='drive'?<BookOpen size={13}/>:<ExternalLink size={13}/>}</button>)}{related.length<2&&<p className="muted">Add an original slide PDF or Goodnotes annotated copy to switch between them here.</p>}</div>
      </aside>}
    </div>
  </div>;
}
