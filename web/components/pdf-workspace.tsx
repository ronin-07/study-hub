'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ExternalLink, FileText, LoaderCircle, PanelRightClose, PanelRightOpen, RotateCcw, Timer, X } from 'lucide-react';
import type { Course, Item, Resource } from '@/lib/types';
import { activityResources, isExamResource, readerMaterials } from '@/lib/resource-links';
import { examName } from '@/lib/exam-prep';
import { sortWeeklyActivities } from '@/lib/task-view';
import { PdfReader } from './pdf-reader';
import { type PdfMarkChange, type PdfSession, type StudyPdf } from '@/lib/pdf-study';

type Props = {
  pdf: StudyPdf; session: PdfSession; opening: boolean;
  items: Item[]; course?: Course; resource?: Resource; resources: Resource[];
  pendingItems: ReadonlySet<string>; completingIds: ReadonlySet<string>;
  onClose: () => void; onPage: (key: string, page: number) => void;
  onCloseTab: (key: string) => void; onSelectTab: (key: string) => void;
  onSplit: (key: string | null) => void; onMinimize: () => void;
  onMark: (key: string, change: PdfMarkChange) => Promise<void>;
  onLoadMarks: (key: string) => void;
  onOpenResource: (resource: Resource) => void;
  onBrowseCourse?: () => void;
  onToggleItem: (item: Item) => void; onFocus: (item?: Item) => void;
};
const materialLabels: Record<Resource['kind'],string> = {
  slides:'Slides',annotated:'Annotated notes',handwritten:'Handwritten notes',textbook:'Textbook',
  exam_paper:'Question paper',exam_solution:'Solution',other:'Resource',
};
const materialPreviewCount=4;
const pdfReaderPreference = 'studyhub.pdfjs-reader';

function prefersPdfJs() {
  try { return window.localStorage.getItem(pdfReaderPreference) === 'enabled'; }
  catch { return false; }
}

/** Native browser PDF iframe: preserves PDF annotations/links in original PDFs.
 * The saved page is explicit; native PDF scrolling is not accessible across the iframe.
 */
export function PdfWorkspace({ pdf, session, opening, items, course, resource, resources, pendingItems, completingIds,
  onClose, onPage, onCloseTab, onSelectTab, onSplit, onMinimize, onMark, onLoadMarks, onOpenResource, onBrowseCourse, onToggleItem, onFocus }: Props) {
  const [draft,setDraft] = useState(String(pdf.page));
  const [studyOpen,setStudyOpen] = useState(!!course);
  const [frameReady,setFrameReady] = useState(false);
  const [frameSlow,setFrameSlow] = useState(false);
  const [frameError,setFrameError] = useState(false);
  const [frameRevision,setFrameRevision] = useState(0);
  const [pdfJs,setPdfJs] = useState(prefersPdfJs);
  const [failedKey,setFailedKey] = useState<string | null>(null);
  const dialogRef=useRef<HTMLDivElement>(null);
  const pdfJsFailed=failedKey===pdf.key;
  const usePdfJs = pdfJs && !pdfJsFailed;
  const split = usePdfJs ? session.tabs.find(tab=>tab.key===session.split && tab.key!==pdf.key) : undefined;
  const handlePdfJsFailure = useCallback(() => {
    setFrameReady(false);
    setFailedKey(pdf.key);
  }, [pdf.key]);
  const changeViewer = () => {
    const enabled = !usePdfJs;
    setPdfJs(enabled);
    setFailedKey(null);
    setFrameReady(false);
    setFrameSlow(false);
    setFrameError(false);
    try { window.localStorage.setItem(pdfReaderPreference, enabled ? 'enabled' : 'disabled'); }
    catch { /* The choice still applies to this open reader. */ }
  };
  useEffect(()=>setDraft(String(pdf.page)),[pdf.page]);
  useEffect(()=>{
    if(window.matchMedia('(max-width: 690px)').matches)setStudyOpen(false);
  },[]);
  useEffect(()=>{
    // The onLoad event can be quicker than a passive effect for small documents.
    // Do not reset an already-ready frame after onLoad.
    setFrameSlow(false);setFrameError(false);
    if(frameReady||usePdfJs)return;
    const timer=window.setTimeout(()=>setFrameSlow(true),20000);
    return ()=>window.clearTimeout(timer);
  },[pdf.url,frameRevision,frameReady,usePdfJs]);
  useEffect(()=>{
    const dialog=dialogRef.current;
    const opener=document.activeElement;
    if(dialog&&!dialog.contains(opener))dialog.querySelector<HTMLButtonElement>('.pdf-close-reader')?.focus();
    return ()=>{if(opener instanceof HTMLElement&&opener.isConnected&&!dialog?.contains(opener))opener.focus();};
  },[]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(opening)return;
      if(event.key==='Escape'){onClose();return;}
      if(event.key!=='Tab')return;
      const controls=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],iframe,[tabindex="0"]'
      )??[]).filter(control=>control.tabIndex>=0&&control.getClientRects().length>0);
      const first=controls[0], last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first&&last){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last&&first){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',handler);
    return ()=>document.removeEventListener('keydown',handler);
  },[onClose,opening]);
  const savePage=()=>{
    const page=Number(draft);
    if(!draft.trim()||!Number.isFinite(page)){setDraft(String(pdf.page));return;}
    const next=Math.max(1,Math.min(20000,Math.floor(page)));
    setDraft(String(next));
    if(next!==pdf.page)onPage(pdf.key,next);
  };
  const exam=!!resource&&isExamResource(resource.kind);
  const sameWeekItems=pdf.weekNumber==null?[]:sortWeeklyActivities(items.filter(item=>item.course_id===pdf.courseId&&item.week_number===pdf.weekNumber));
  const related=readerMaterials(resource,pdf.weekNumber,sameWeekItems,resources);
  const linkedTask=resource&&items.find(item=>!item.done&&activityResources(item,[resource]).length>0
    && (exam?item.kind==='revision':item.week_number===pdf.weekNumber));
  const focusItem=linkedTask||sameWeekItems.find(item=>!item.done);
  const context=exam?'Exam Prep':pdf.weekNumber!=null?`Week ${pdf.weekNumber}`:course?'Course Library':'Drive preview';
  const title=resource?.kind==='exam_paper'?examName(resource):pdf.title;
  const materialRow=(entry:Resource)=>{
    const name=entry.kind==='exam_paper'?examName(entry):entry.title;
    const Icon=entry.source==='drive'&&entry.drive_file_id?BookOpen:ExternalLink;
    return <button type="button" className="pdf-related" key={entry.id} title={entry.title} onClick={()=>onOpenResource(entry)}>
      <FileText size={16} aria-hidden="true"/>
      <span className="pdf-related-copy"><strong>{name}</strong><small>{materialLabels[entry.kind]}</small></span>
      <Icon size={14} aria-hidden="true"/>
    </button>;
  };
  return <div ref={dialogRef} className={'pdf-overlay pdf-workspace'+(studyOpen?'':' pdf-expanded')} role="dialog" aria-modal="true" aria-label={`Reading ${pdf.title}`}>
    <div className="pdf-topbar">
      <div className="pdf-file-title"><BookOpen size={18} aria-hidden="true"/><div><strong title={pdf.title}>{title}</strong><span>{course?`${course.code} · ${context}`:context}</span></div></div>
      <div className="pdf-actions">
        {!usePdfJs&&<div className="pdf-bookmark" role="group" aria-label="PDF bookmark">
          <button type="button" className="btn secondary small" title="Previous bookmarked page" aria-label="Previous bookmarked page" disabled={pdf.page<=1} onClick={()=>onPage(pdf.key,pdf.page-1)}><ArrowLeft size={15}/></button>
          <label>{pdf.resourceId?'Saved page':'Page'} <input aria-label={pdf.resourceId?'Bookmarked PDF page':'PDF page'} type="number" min={1} max={20000} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={savePage} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
          <button type="button" className="btn secondary small" title="Next bookmarked page" aria-label="Next bookmarked page" disabled={pdf.page>=20000} onClick={()=>onPage(pdf.key,pdf.page+1)}><ArrowRight size={15}/></button>
        </div>}
        <button type="button" className="btn secondary small pdf-viewer-choice" onClick={changeViewer}>
          {usePdfJs ? 'Browser viewer' : pdfJsFailed ? 'Retry PDF.js' : 'Try PDF.js'}
        </button>
        <button type="button" className="btn secondary small pdf-toggle-study" title={studyOpen?'Hide Study Mode':'Show Study Mode'} aria-label={studyOpen?'Hide Study Mode sidebar':'Show Study Mode sidebar'} aria-expanded={studyOpen} onClick={()=>setStudyOpen(value=>!value)}>{studyOpen?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}<span>Study panel</span></button>
        <button type="button" className="btn secondary small pdf-close-reader" onClick={onClose}><X size={16} aria-hidden="true"/> Close</button>
      </div>
    </div>
    <nav className="pdfjs-tabs" aria-label="Open PDFs">
      {session.tabs.map(tab=><div className="pdfjs-tab" key={tab.key}>
        <button type="button" className="btn secondary small" aria-pressed={tab.key===pdf.key} title={tab.title} onClick={()=>onSelectTab(tab.key)}>{tab.title}</button>
        <button type="button" className="btn secondary small" aria-label={`Close PDF tab ${tab.title}`} onClick={()=>onCloseTab(tab.key)}><X size={13} aria-hidden="true"/></button>
      </div>)}
      <button type="button" className="btn secondary small" onClick={onMinimize}>Open another PDF</button>
      {usePdfJs&&session.tabs.length>1&&<label>Read side by side
        <select aria-label="Read side by side" value={session.split??''} onChange={event=>onSplit(event.target.value||null)}>
          <option value="">Off</option>
          {session.tabs.filter(tab=>tab.key!==pdf.key).map(tab=><option key={tab.key} value={tab.key}>{tab.title}</option>)}
        </select>
      </label>}
    </nav>
    <div className="pdf-reading-layout">
      <div className="pdf-document-panel">
        {pdfJsFailed&&<p className="pdfjs-fallback" role="status">PDF.js couldn’t display this document. The browser viewer is open.</p>}
        {usePdfJs ? <div className={split ? 'pdfjs-panes is-split' : 'pdfjs-panes'}>
          {(split?[pdf,split]:[pdf]).map(tab=><PdfPane key={tab.url} pdf={tab} primary={tab.key===pdf.key}
            heading={split ? (tab.key===pdf.key ? title : tab.title) : undefined}
            onPrimaryFailure={handlePdfJsFailure} onPage={onPage} onMark={onMark} onLoadMarks={onLoadMarks}/>)}
        </div>
        : <div className="pdf-document-scroll">
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
        </div>}
      </div>
      {studyOpen&&<aside className="pdf-study-side" aria-label="Study activity sidebar">
        <div className="pdf-side-block pdf-study-header">
          <h3>Study panel</h3>
          {usePdfJs ? <p>{pdf.resourceId ? 'Reading position saves automatically.' : 'Reading position saves in this browser.'}</p>
            : pdf.resourceId&&<p>Enter a PDF page number in Saved page to return to it later.</p>}
          <button type="button" className="btn primary full" disabled={course?.archived} onClick={()=>onFocus(focusItem)}><Timer size={16} aria-hidden="true"/> Start Focus</button>
          {focusItem&&<small>Next activity · {focusItem.title}</small>}
        </div>
        {sameWeekItems.length>0&&<div className="pdf-side-block">
          <h3>Week {pdf.weekNumber} checklist <small>{sameWeekItems.filter(i=>i.done||completingIds.has(i.id)).length}/{sameWeekItems.length}</small></h3>
          {sameWeekItems.map(i=><label className={'pdf-check task-completion-row'+(completingIds.has(i.id)?' is-completing':'')} key={i.id}><input type="checkbox" className="task-completion-check" checked={i.done||completingIds.has(i.id)} disabled={!!course?.archived||pendingItems.has(i.id)||completingIds.has(i.id)} onChange={()=>onToggleItem(i)}/><span>{i.title}</span></label>)}
        </div>}
        {(related.length>0||onBrowseCourse)&&<div className="pdf-side-block">
          {related.length>0&&<>
            <h3>{exam?'Exam documents':`Week ${pdf.weekNumber} materials`}</h3>
            <div className="pdf-material-list">{related.slice(0,materialPreviewCount).map(materialRow)}</div>
            {related.length>materialPreviewCount&&<details className="pdf-more-materials">
              <summary>{related.length-materialPreviewCount} more materials <ChevronDown size={15} aria-hidden="true"/></summary>
              <div className="pdf-material-list">{related.slice(materialPreviewCount).map(materialRow)}</div>
            </details>}
          </>}
          {onBrowseCourse&&<button type="button" className="btn secondary small pdf-browse-course" onClick={onBrowseCourse}>{exam?'Open Exam Prep':'Open Course Library'} <ArrowRight size={14} aria-hidden="true"/></button>}
        </div>}
      </aside>}
    </div>
  </div>;
}

function PdfPane({ pdf, primary, heading, onPrimaryFailure, onPage, onMark, onLoadMarks }: {
  pdf: StudyPdf; primary: boolean; heading?: string; onPrimaryFailure: () => void;
  onPage: Props['onPage']; onMark: Props['onMark']; onLoadMarks: Props['onLoadMarks'];
}) {
  const [failed,setFailed] = useState(false);
  const fallback = useCallback(()=>setFailed(true),[]);
  useEffect(()=>{if(failed&&primary)onPrimaryFailure();},[failed,primary,onPrimaryFailure]);
  return <div className="pdfjs-pane">
    {heading&&<h3>{heading}</h3>}
    {failed ? <>
      <p className="pdfjs-fallback" role="status">PDF.js couldn’t display this document. The browser viewer is open.</p>
      <button type="button" className="btn secondary small" onClick={()=>setFailed(false)}>Retry PDF.js</button>
      <iframe className="pdfjs-split-fallback" title={pdf.title} src={`${pdf.url}#page=${pdf.page}`}/>
    </> : <PdfReader url={pdf.url} title={pdf.title} initialPage={pdf.page} marks={pdf.marks} autoFocus={primary}
      marksStatus={pdf.marksStatus} onLoadMarks={()=>onLoadMarks(pdf.key)}
      onPage={page=>onPage(pdf.key,page)} onMark={change=>onMark(pdf.key,change)} onFailure={fallback}/>}
  </div>;
}
