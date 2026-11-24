'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, LoaderCircle, RotateCcw } from 'lucide-react';

type OpeningProps = {
  title: string; status: 'loading'|'error'; error?: string; requestId: number;
  onCancel: () => void; onRetry: () => void;
};

/** Shown as soon as Preview is clicked, before the authorized download starts.
 * Chrome's native PDF viewer gives us no accurate byte-level render progress.
 */
export function PdfOpeningOverlay({ title, status, error, requestId, onCancel, onRetry }: OpeningProps) {
  const [slow,setSlow] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSlow(false);
    if(status !== 'loading')return;
    const timer=window.setTimeout(()=>setSlow(true),20000);
    return ()=>window.clearTimeout(timer);
  },[status,requestId]);
  useEffect(()=>{cancelRef.current?.focus();},[requestId]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onCancel();return;}
      if(event.key!=='Tab')return;
      const controls=Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKey);
    return ()=>document.removeEventListener('keydown',onKey);
  },[onCancel]);
  return <div className="pdf-overlay pdf-opening" role="dialog" aria-modal="true" aria-label={`Opening ${title}`}>
    <div ref={cardRef} className="pdf-opening-card" aria-busy={status==='loading'}>
      <div className="pdf-opening-icon">{status==='loading'?<LoaderCircle className="spin" size={27}/>:<FileText size={26}/>}</div>
      <h2>{status==='error'?'Could not open this PDF':'Opening your PDF'}</h2>
      <strong className="pdf-opening-filename" title={title}>{title}</strong>
      {status==='loading'?<>
        <p role="status">{slow?'This document is taking longer than usual. You can cancel safely.':'Retrieving your document from Google Drive…'}</p>
        <span className="pdf-opening-indicator" aria-hidden="true"/>
      </>:<p role="alert">{error||'Please try again.'}</p>}
      <div className="pdf-opening-actions">
        <button ref={cancelRef} type="button" className="btn secondary" onClick={onCancel}>{status==='loading'?'Cancel':'Close'}</button>
        {status==='error'&&<button type="button" className="btn primary" onClick={onRetry}><RotateCcw size={16}/> Retry</button>}
      </div>
    </div>
  </div>;
}

