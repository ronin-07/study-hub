'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, Columns2, Ellipsis, ExternalLink, FileText, LoaderCircle, PanelRightClose, PanelRightOpen, Plus, RotateCcw, Timer, X } from 'lucide-react';
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
  onZoom: (key: string, zoom: string) => void;
  onCloseTab: (key: string) => void; onSelectTab: (key: string) => void;
  onSplit: (key: string | null) => void; onResizeSplit: (percent: number) => void; onMinimize: () => void;
  onMark: (key: string, change: PdfMarkChange) => Promise<void>;
  onLoadMarks: (key: string) => void;
  onOpenResource: (resource: Resource, beside?: boolean) => void;
  onBrowseCourse?: () => void;
  onToggleItem: (item: Item) => void; onFocus: (item?: Item) => void;
};
const materialLabels: Record<Resource['kind'],string> = {
  slides:'Slides',annotated:'Annotated notes',handwritten:'Handwritten notes',textbook:'Textbook',
  exam_paper:'Question paper',exam_solution:'Solution',other:'Resource',
};
const materialPreviewCount=4;
const pdfReaderPreference = 'studyhub.pdfjs-reader';
const splitMin = 30;
const splitMax = 70;

function prefersPdfJs() {
  try { return window.localStorage.getItem(pdfReaderPreference) === 'enabled'; }
  catch { return false; }
}

/** Native browser PDF iframe: preserves PDF annotations/links in original PDFs.
 * The saved page is explicit; native PDF scrolling is not accessible across the iframe.
 */
export function PdfWorkspace({ pdf, session, opening, items, course, resource, resources, pendingItems, completingIds,
  onClose, onPage, onZoom, onCloseTab, onSelectTab, onSplit, onResizeSplit, onMinimize, onMark, onLoadMarks, onOpenResource, onBrowseCourse, onToggleItem, onFocus }: Props) {
  const [draft,setDraft] = useState(String(pdf.page));
  const [studyOpen,setStudyOpen] = useState(!!course);
  const [frameReady,setFrameReady] = useState(false);
  const [frameSlow,setFrameSlow] = useState(false);
  const [frameError,setFrameError] = useState(false);
  const [frameRevision,setFrameRevision] = useState(0);
  const [pdfJs,setPdfJs] = useState(prefersPdfJs);
  const [failedKey,setFailedKey] = useState<string | null>(null);
  const dialogRef=useRef<HTMLDivElement>(null);
  const optionsRef=useRef<HTMLDetailsElement>(null);
  const panesRef=useRef<HTMLDivElement>(null);
  const dragRef=useRef<{id:number;offset:number}|null>(null);
  const {splitPercent}=session;
  const [stacked,setStacked]=useState(false);
  const sizeSplit=(value:number)=>onResizeSplit(Math.max(splitMin,Math.min(splitMax,Math.round(value))));
  const pdfJsFailed=failedKey===pdf.key;
  const usePdfJs = pdfJs && !pdfJsFailed;
  const split = usePdfJs ? session.tabs.find(tab=>tab.key===session.split && tab.key!==pdf.key) : undefined;
  const handlePdfJsFailure = useCallback(() => {
    setFrameReady(false);
    setFailedKey(pdf.key);
  }, [pdf.key]);
  const changeViewer = () => {
    if(optionsRef.current)optionsRef.current.open=false;
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
    const narrow=window.matchMedia('(max-width: 690px)');
    if(narrow.matches)setStudyOpen(false);
    const measure=()=>setStacked(narrow.matches);
    measure();
    narrow.addEventListener('change',measure);
    return ()=>narrow.removeEventListener('change',measure);
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
      if(event.key==='Escape'){
        const options=optionsRef.current;
        if(options?.open){options.open=false;options.querySelector('summary')?.focus();}
        else onClose();
        return;
      }
      if(event.key!=='Tab')return;
      const controls=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],iframe,summary,[tabindex="0"]'
      )??[]).filter(control=>control.tabIndex>=0&&control.getClientRects().length>0);
      const first=controls[0], last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first&&last){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last&&first){event.preventDefault();first.focus();}
    };
    const dismiss=(event:PointerEvent)=>{
      const options=optionsRef.current;
      if(options?.open&&event.target instanceof Node&&!options.contains(event.target))options.open=false;
    };
    document.addEventListener('keydown',handler);
    document.addEventListener('pointerdown',dismiss);
    return ()=>{document.removeEventListener('keydown',handler);document.removeEventListener('pointerdown',dismiss);};
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
    return <div className="pdf-related-row" key={entry.id}>
      <button type="button" className="pdf-related" title={entry.title} onClick={()=>onOpenResource(entry)}>
        <FileText size={16} aria-hidden="true"/>
        <span className="pdf-related-copy"><strong>{name}</strong><small>{materialLabels[entry.kind]}</small></span>
        <Icon size={14} aria-hidden="true"/>
      </button>
      {usePdfJs&&entry.source==='drive'&&entry.drive_file_id&&entry.id!==pdf.resourceId&&
        <button type="button" className="btn secondary small pdf-open-beside" aria-label={`Open ${name} beside current PDF`}
          onClick={()=>onOpenResource(entry,true)}><Columns2 size={14} aria-hidden="true"/> Open beside</button>}
    </div>;
  };
  return <div ref={dialogRef} className={'pdf-overlay pdf-workspace'+(studyOpen?'':' pdf-expanded')} role="dialog" aria-modal="true" aria-label={`Reading ${pdf.title}`}>
    <div className="pdf-topbar">
      <div className="pdf-file-title"><span className="pdfjs-file-icon"><BookOpen size={17} aria-hidden="true"/></span><div><strong title={pdf.title}>{title}</strong><span>{course?`${course.code} · ${context}`:context}</span></div></div>
      <div className="pdf-actions">
        {!usePdfJs&&<div className="pdf-bookmark" role="group" aria-label="PDF bookmark">
          <button type="button" className="btn secondary small" title="Previous bookmarked page" aria-label="Previous bookmarked page" disabled={pdf.page<=1} onClick={()=>onPage(pdf.key,pdf.page-1)}><ArrowLeft size={15}/></button>
          <label>{pdf.resourceId?'Saved page':'Page'} <input aria-label={pdf.resourceId?'Bookmarked PDF page':'PDF page'} type="number" min={1} max={20000} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={savePage} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
          <button type="button" className="btn secondary small" title="Next bookmarked page" aria-label="Next bookmarked page" disabled={pdf.page>=20000} onClick={()=>onPage(pdf.key,pdf.page+1)}><ArrowRight size={15}/></button>
        </div>}
        {!usePdfJs&&<button type="button" className="btn secondary small pdf-viewer-choice" onClick={changeViewer}>
          {pdfJsFailed ? 'Retry PDF.js' : 'Try PDF.js'}
        </button>}
        <button type="button" className="btn secondary small pdf-toggle-study" title={studyOpen?'Hide Study Mode':'Show Study Mode'} aria-label={studyOpen?'Hide Study Mode sidebar':'Show Study Mode sidebar'} aria-expanded={studyOpen} onClick={()=>setStudyOpen(value=>!value)}>{studyOpen?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}<span>Study panel</span></button>
        {usePdfJs&&<details className="pdfjs-options" ref={optionsRef}>
          <summary className="btn secondary small" aria-label="Reader options" title="Reader options"><Ellipsis size={17} aria-hidden="true"/></summary>
          <div className="pdfjs-options-popover"><button type="button" className="btn secondary small" onClick={changeViewer}><ExternalLink size={15} aria-hidden="true"/> Use browser viewer</button></div>
        </details>}
        <button type="button" className="btn secondary small pdf-close-reader" aria-label="Close" title="Close reader" onClick={onClose}><X size={16} aria-hidden="true"/></button>
      </div>
    </div>
    <nav className="pdfjs-tabs" aria-label="Open PDFs">
      <div className="pdfjs-tab-list">
      {session.tabs.map(tab=><div className="pdfjs-tab" key={tab.key} data-active={tab.key===pdf.key}>
        <button type="button" className="btn secondary small" aria-pressed={tab.key===pdf.key} title={tab.title} onClick={()=>onSelectTab(tab.key)}><FileText size={14} aria-hidden="true"/><span>{tab.title}</span></button>
        <button type="button" className="btn secondary small" aria-label={`Close PDF tab ${tab.title}`} onClick={()=>onCloseTab(tab.key)}><X size={13} aria-hidden="true"/></button>
      </div>)}
      <button type="button" className="btn secondary small pdfjs-open-tab" onClick={onMinimize}><Plus size={15} aria-hidden="true"/> Open PDF</button>
      </div>
      {usePdfJs&&session.tabs.length>1&&<label className="pdfjs-split-picker"><Columns2 size={15} aria-hidden="true"/> Split view
        <span className="pdfjs-select"><select aria-label="Read side by side" value={session.split??''} onChange={event=>onSplit(event.target.value||null)}>
          <option value="">Off</option>
          {session.tabs.filter(tab=>tab.key!==pdf.key).map(tab=><option key={tab.key} value={tab.key}>{tab.title}</option>)}
        </select><ChevronDown size={13} aria-hidden="true"/></span>
      </label>}
    </nav>
    <div className="pdf-reading-layout">
      <div className="pdf-document-panel">
        {pdfJsFailed&&<p className="pdfjs-fallback" role="status">PDF.js couldn’t display this document. The browser viewer is open.</p>}
        {usePdfJs ? <div ref={panesRef} className={split ? 'pdfjs-panes is-split' : 'pdfjs-panes'}
          style={split ? {'--pdf-split-first':`${splitPercent}fr`,'--pdf-split-second':`${100-splitPercent}fr`} as CSSProperties : undefined}>
          {(split?[pdf,split]:[pdf]).map(tab=><PdfPane key={tab.url} pdf={tab} primary={tab.key===pdf.key}
            heading={split ? (tab.key===pdf.key ? title : tab.title) : undefined}
            onPrimaryFailure={handlePdfJsFailure} onPage={onPage} onZoom={onZoom} onMark={onMark} onLoadMarks={onLoadMarks}/>)}
          {split&&<div className="pdfjs-split-divider" role="separator" tabIndex={0} aria-label="Resize PDF panes"
            aria-orientation={stacked?'horizontal':'vertical'} aria-valuemin={splitMin} aria-valuemax={splitMax} aria-valuenow={splitPercent}
            aria-valuetext={`First PDF ${splitPercent} percent`} title="Drag to resize. Double-click to reset."
            onDoubleClick={()=>sizeSplit(50)}
            onKeyDown={event=>{
              const decrement=stacked?'ArrowUp':'ArrowLeft', increment=stacked?'ArrowDown':'ArrowRight';
              if(event.key===decrement||event.key===increment){event.preventDefault();sizeSplit(splitPercent+(event.key===decrement?-5:5));}
              else if(event.key==='Home'||event.key==='End'){event.preventDefault();sizeSplit(event.key==='Home'?splitMin:splitMax);}
              else if(event.key==='Enter'){event.preventDefault();sizeSplit(50);}
            }}
            onPointerDown={event=>{
              if(event.button!==0||dragRef.current)return;
              const rect=event.currentTarget.getBoundingClientRect();
              dragRef.current={id:event.pointerId,offset:stacked?event.clientY-rect.top:event.clientX-rect.left};
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event=>{
              const drag=dragRef.current, panes=panesRef.current;
              if(!drag||drag.id!==event.pointerId||!panes)return;
              const rect=panes.getBoundingClientRect();
              const extent=stacked?rect.height-event.currentTarget.offsetHeight:rect.width-event.currentTarget.offsetWidth;
              const point=stacked?event.clientY-rect.top:event.clientX-rect.left;
              if(extent>0)sizeSplit((point-drag.offset)/extent*100);
            }}
            onLostPointerCapture={()=>{dragRef.current=null;}}/>}
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

function PdfPane({ pdf, primary, heading, onPrimaryFailure, onPage, onZoom, onMark, onLoadMarks }: {
  pdf: StudyPdf; primary: boolean; heading?: string; onPrimaryFailure: () => void;
  onPage: Props['onPage']; onZoom: Props['onZoom']; onMark: Props['onMark']; onLoadMarks: Props['onLoadMarks'];
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
    </> : <PdfReader url={pdf.url} title={pdf.title} initialPage={pdf.page} initialZoom={pdf.zoom}
      onZoom={zoom=>onZoom(pdf.key,zoom)} marks={pdf.marks} autoFocus={primary}
      marksStatus={pdf.marksStatus} onLoadMarks={()=>onLoadMarks(pdf.key)}
      onPage={page=>onPage(pdf.key,page)} onMark={change=>onMark(pdf.key,change)} onFailure={fallback}/>}
  </div>;
}
