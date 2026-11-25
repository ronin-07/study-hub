'use client';

import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, LoaderCircle, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Course } from '@/lib/types';
import type { MutationHint } from '@/lib/snapshot-cache';
import type { FeedbackMessage } from '@/components/feedback-toasts';
import { FormRow } from '@/components/common';

type Preview = { course_id:string; code:string; title:string; items:number; weeks:number; resources:number; exam_attempts:number; focus_sessions:number; total_documents:number; blockers:string[]; preview_token:string };
interface Props {
  course:Course; user:User|null; busy:boolean;
  run:(operation:()=>Promise<unknown>,mutation?:MutationHint,feedback?:FeedbackMessage)=>Promise<boolean>;
  onClose:()=>void; onDeleted:()=>void;
}

export function CourseDeletionDialog({course,user,busy,run,onClose,onDeleted}:Props) {
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [revision,setRevision]=useState(0);
  const [submitting,setSubmitting]=useState(false);
  const submitGuard=useRef(false);
  const closeRef=useRef<HTMLButtonElement>(null);
  const panelRef=useRef<HTMLDivElement>(null);
  const closeCallback=useRef(onClose);closeCallback.current=onClose;
  const disabled=busy||submitting;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    closeRef.current?.focus();
    return ()=>previous?.focus();
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    const load=async()=>{
      try {
        const value=await api<Preview>(`/api/courses/${course.id}/deletion-preview`,user,{signal:controller.signal});
        if(!controller.signal.aborted)setPreview(value);
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Unable to check course data.');}
    };
    void load();return ()=>controller.abort();
  },[course.id,user,revision]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!disabled){event.preventDefault();closeCallback.current();}
      if(event.key==='Tab'){
        const elements=Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')||[]);
        if(!elements.length){event.preventDefault();panelRef.current?.focus();return;}
        const first=elements[0],last=elements[elements.length-1];
        if(!panelRef.current?.contains(document.activeElement)){event.preventDefault();first.focus();}
        else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',key);return ()=>document.removeEventListener('keydown',key);
  },[disabled]);
  const reload=()=>{setPreview(null);setError('');setConfirmation('');setRevision(v=>v+1);};
  const remove=async()=>{
    if(submitGuard.current||disabled||!preview||preview.course_id!==course.id||preview.blockers.length||confirmation!=='DELETE')return;
    submitGuard.current=true;setSubmitting(true);
    try {
      // Rare destructive operation: force a fresh workspace snapshot after the
      // atomic delete rather than risk retaining any related cached record.
      const ok=await run(()=>api(`/api/courses/${course.id}/permanent-delete`,user,{method:'POST',body:{confirmation,preview_token:preview.preview_token}}),undefined,{title:'Course permanently deleted',detail:`${course.code} and its study records were removed.`});
      if(ok){onDeleted();return;}
      setError('Deletion was not confirmed. Check current course data before retrying.');setPreview(null);setConfirmation('');
    }finally{submitGuard.current=false;setSubmitting(false);}
  };
  return <div className="dialog-backdrop" role="presentation"><div ref={panelRef} tabIndex={-1} className="dialog planner-dialog planner-delete-course-dialog" role="dialog" aria-modal="true" aria-labelledby="course-delete-title">
    <button ref={closeRef} className="dialog-close" disabled={disabled} onClick={onClose} aria-label="Close deletion dialog"><X size={18}/></button>
    <div className="planner-delete-course-heading"><AlertTriangle size={23}/><h2 id="course-delete-title">Permanently delete course?</h2></div>
    <p>This cannot be undone. Only archived courses without Focus history can be deleted.</p>
    <strong>{preview?.code||course.code} · {preview?.title||course.title}</strong>
    {error?<div role="alert" className="planner-delete-course-warning"><p>{error}</p><button type="button" className="btn secondary small" disabled={disabled} onClick={reload}>Check again</button></div>:!preview?<p role="status" className="planner-save-status"><LoaderCircle size={15} className="spin"/> Checking course records…</p>:<>
      <dl className="planner-delete-course-counts">
        {([['Course record',1],['Study activities',preview.items],['Saved teaching weeks',preview.weeks],['Resource links (including bookmarks)',preview.resources],['Exam attempts (inside resources)',preview.exam_attempts],['Focus sessions (protected)',preview.focus_sessions],['Documents to delete',preview.total_documents]] as [string,number][]).map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
      </dl>
      <p>Original Google Drive files, your semester and other courses will not be deleted.</p>
      {preview.blockers.length?<div className="planner-delete-course-warning" role="alert">{preview.blockers.map(reason=><p key={reason}>{reason}</p>)}</div>:<FormRow label="Type DELETE to confirm"><input autoComplete="off" spellCheck={false} value={confirmation} disabled={disabled} onChange={event=>setConfirmation(event.target.value)} placeholder="DELETE"/></FormRow>}
    </>}
    <div className="form-actions"><button className="btn secondary" disabled={disabled} onClick={onClose}>Cancel</button><button type="button" className="btn planner-delete-course-confirm" disabled={disabled||!preview||preview.course_id!==course.id||!!preview.blockers.length||confirmation!=='DELETE'} aria-busy={submitting} onClick={()=>void remove()}>{submitting?<><LoaderCircle size={15} className="spin"/> Deleting…</>:<><Trash2 size={15}/> Delete permanently</>}</button></div>
  </div></div>;
}
