'use client';

import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { BookOpen, FileText, LoaderCircle, ShieldCheck, Unlink, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Item, Resource } from '@/lib/types';
import type { MutationHint } from '@/lib/snapshot-cache';
import type { FeedbackMessage } from '@/components/feedback-toasts';

type Preview = {resource_id:string;title:string;source:Resource['source'];course_code:string;affected_count:number;activities:{id:string;title:string;week_number:number|null}[];blockers:string[];preview_token:string};
interface Props {
  resource:Resource;user:User|null;busy:boolean;
  run:(operation:()=>Promise<unknown>,mutation?:MutationHint,feedback?:FeedbackMessage)=>Promise<boolean>;
  onClose:()=>void;
}
export function ResourceRemovalDialog({resource,user,busy,run,onClose}:Props){
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const [submitting,setSubmitting]=useState(false);
  const guard=useRef(false);
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
    void api<Preview>(`/api/resources/${resource.id}/removal-preview`,user,{signal:controller.signal}).then(value=>{
      if(!controller.signal.aborted)setPreview(value);
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not check linked activities.');});
    return ()=>controller.abort();
  },[resource.id,user,revision]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!disabled){event.preventDefault();closeCallback.current();}
      if(event.key==='Tab'){
        const elements=Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')||[]);
        if(!elements.length){event.preventDefault();panelRef.current?.focus();return;}
        const first=elements[0],last=elements[elements.length-1];
        if(!panelRef.current?.contains(document.activeElement)){event.preventDefault();first.focus();}
        else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',key);return ()=>document.removeEventListener('keydown',key);
  },[disabled]);
  const reload=()=>{setPreview(null);setError('');setRevision(v=>v+1);};
  const remove=async()=>{
    if(guard.current||disabled||!preview||preview.resource_id!==resource.id||preview.blockers.length)return;
    guard.current=true;setSubmitting(true);
    try{
      const ok=await run(()=>api<{resource_id:string;items:Item[]}>(`/api/resources/${resource.id}/remove`,user,{method:'POST',body:{preview_token:preview.preview_token}}),
        {collection:'resources',deleteId:resource.id,removeWithLinks:true}, {title:'Resource removed',detail:'Your study activities and original file were kept.'});
      if(ok){onClose();return;}
      setPreview(null);setError('Removal was not confirmed. Check the current resource again before retrying. If it was already removed, refresh your workspace.');
    }finally{guard.current=false;setSubmitting(false);}
  };
  return <div className="dialog-backdrop" role="presentation"><div ref={panelRef} tabIndex={-1} className="dialog planner-dialog planner-delete-course-dialog planner-resource-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-removal-title">
    <button ref={closeRef} className="dialog-close" disabled={disabled} onClick={onClose} aria-label="Close removal dialog"><X size={18}/></button>
    <div className="planner-delete-course-heading"><Unlink size={23}/><h2 id="resource-removal-title">{preview?.affected_count?'Remove linked resource?':'Remove resource?'}</h2></div>
    <div className="planner-resource-removal-file"><FileText size={22}/><div><strong>{preview?.title||resource.title}</strong><small>{(preview?.source||resource.source)==='drive'?'Google Drive':(preview?.source||resource.source)==='dtu'?'DTU Learn':'External link'}</small></div></div>
    {error?<div className="planner-delete-course-warning" role="alert"><p>{error}</p><button type="button" className="btn secondary small" disabled={disabled} onClick={reload}>Check again</button></div>:!preview?<p role="status" className="planner-save-status"><LoaderCircle size={15} className="spin"/> Checking linked activities…</p>:<>
      <p>{preview.affected_count?`This resource is linked to ${preview.affected_count} study ${preview.affected_count===1?'activity':'activities'}. Removing it will clear these file links.`:'This resource has no linked study activities.'}</p>
      {!!preview.activities.length&&<div className="planner-resource-removal-list"><strong>Affected activities</strong><div className="planner-resource-removal-scroll" tabIndex={0} role="region" aria-label="Affected activities">{preview.activities.map(item=><div key={item.id}><BookOpen size={15}/><span><strong>{item.title}</strong><small>{preview.course_code} · {item.week_number===null?'Course-wide':`Week ${item.week_number}`}</small></span></div>)}</div></div>}
      {preview.blockers.length>0&&<div className="planner-delete-course-warning" role="alert">{preview.blockers.map(reason=><p key={reason}>{reason}</p>)}</div>}
      <div className="planner-resource-removal-safe"><ShieldCheck size={20}/><p>Only the Study Hub resource entry and its links are removed. Your original file, activities, completion progress, dates, notes and Focus history will be kept. Any saved page bookmark on this resource will be removed with it.</p></div>
    </>}
    <div className="form-actions"><button type="button" className="btn secondary" disabled={disabled} onClick={onClose}>Cancel</button><button type="button" className="btn planner-delete-course-confirm" disabled={disabled||!preview||preview.resource_id!==resource.id||!!preview.blockers.length} aria-busy={submitting} onClick={()=>void remove()}>{submitting?<><LoaderCircle size={15} className="spin"/> Removing…</>:preview?.affected_count?'Unlink and remove':'Remove resource'}</button></div>
  </div></div>;
}
