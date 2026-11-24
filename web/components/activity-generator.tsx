'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ListChecks, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import type { Course, Item } from '@/lib/types';
import { kindLabels } from '@/lib/types';
import { defaultActivities, generationSummary, MAX_ACTIVITY_TYPES, normalizedActivityName, teachingWeeks, type ActivityChoice, type ActivityDefinition } from '@/lib/activity-generator';

interface Props {
  course:Course; items:Item[]; busy:boolean; offerSetup:boolean;
  onClose:()=>void; onGenerate:(activities:ActivityDefinition[],weeks:number[])=>Promise<boolean>;
}

export function ActivityGenerator({course,items,busy,offerSetup,onClose,onGenerate}:Props) {
  const [setup,setSetup]=useState(offerSetup);
  const [choices,setChoices]=useState<ActivityChoice[]>(()=>defaultActivities.map(a=>({...a,selected:true})));
  const [mode,setMode]=useState<'all'|'specific'>('all');
  const [selectedWeeks,setSelectedWeeks]=useState(()=>teachingWeeks(course.week_count));
  const [custom,setCustom]=useState('');
  const [kind,setKind]=useState<ActivityDefinition['kind']>('exercise');
  const [saving,setSaving]=useState(false);
  const [failed,setFailed]=useState(false);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const submitting=useRef(false);
  useEffect(()=>{
    const dialog=dialogRef.current;
    dialog?.showModal();
    return ()=>{dialog?.close();};
  },[]);
  const allWeeks=teachingWeeks(course.week_count);
  const weeks=mode==='all'?allWeeks:allWeeks.filter(w=>selectedWeeks.includes(w));
  const activities=choices.filter(a=>a.selected).map(({title,kind})=>({title,kind}));
  const summary=generationSummary(items,course.id,activities,weeks);
  const locked=busy||saving;
  const canAdd=!!normalizedActivityName(custom)&&choices.length<MAX_ACTIVITY_TYPES&&!choices.some(a=>normalizedActivityName(a.title)===normalizedActivityName(custom));
  const addCustom=()=>{if(canAdd&&!locked){setChoices(rows=>[...rows,{title:custom.trim(),kind,selected:true}]);setCustom('');}};
  const submit=async()=>{
    if(locked||submitting.current||!summary.created)return;
    submitting.current=true;setSaving(true);setFailed(false);
    try {if(await onGenerate(activities,weeks))onClose();else setFailed(true);}
    catch {setFailed(true);}
    finally {submitting.current=false;setSaving(false);}
  };
  return <dialog ref={dialogRef} className="dialog planner-dialog generator-dialog" aria-labelledby="generator-title" onCancel={e=>{e.preventDefault();if(!locked)onClose();}}>
    <button type="button" className="dialog-close" disabled={locked} onClick={onClose} aria-label="Close activity generator"><X size={18}/></button>
    {setup?<div className="generator-setup">
      <CheckCircle2 size={35}/><h2 id="generator-title">Your course is ready!</h2>
      <strong>{course.code} · {course.title}</strong><p>Would you like to set up recurring learning activities across your {course.week_count} teaching weeks?</p>
      <button type="button" className="btn primary" disabled={locked} onClick={()=>setSetup(false)}>Set up weekly activities</button>
      <button type="button" className="btn secondary" disabled={locked} onClick={onClose}>Skip for now</button>
    </div>:<>
      <header className="generator-heading"><ListChecks size={25}/><div><h2 id="generator-title">Generate activities</h2><p>Set up your weekly learning checklist in seconds.</p></div></header>
      <div className="generator-body">
        <div className="generator-context"><span className="eyebrow">{course.code} · {course.semester}</span><strong>{course.title}</strong><p>{course.week_count} teaching weeks</p></div>
        <fieldset disabled={locked} className="generator-fieldset">
          <legend>1. Select activities</legend>
          <div className="generator-tools"><button type="button" className="btn secondary small" onClick={()=>setChoices(rows=>rows.map(a=>({...a,selected:true})))}>Select all</button><button type="button" className="btn secondary small" onClick={()=>setChoices(rows=>rows.map(a=>({...a,selected:false})))}>Clear all</button></div>
          <div className="generator-choices">{choices.map((a,i)=><div className="generator-choice" key={normalizedActivityName(a.title)}><label><input type="checkbox" className="task-completion-check" checked={a.selected} onChange={e=>setChoices(rows=>rows.map((row,j)=>j===i?{...row,selected:e.target.checked}:row))}/><span>{a.title}<small>{a.kind==='assignment'?'Hand-in · add deadline later':a.kind==='exercise'?'Independent practice':kindLabels[a.kind]}</small></span></label>{i>=defaultActivities.length&&<button type="button" className="btn secondary small" aria-label={`Remove ${a.title}`} onClick={()=>setChoices(rows=>rows.filter((_,j)=>i!==j))}><Trash2 size={14}/></button>}</div>)}</div>
          <label className="generator-custom-label" htmlFor="generator-custom">Add a custom activity</label>
          <div className="generator-custom"><div className="form-row generator-custom-name"><input id="generator-custom" value={custom} maxLength={240} placeholder="e.g. Lab preparation" onChange={e=>setCustom(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCustom();}}}/></div><div className="form-row generator-custom-type"><select aria-label="Custom activity type" value={kind} onChange={e=>setKind(e.target.value as ActivityDefinition['kind'])}>{(['lecture','notes','reading','questions','revision','assignment','exercise'] as const).map(k=><option key={k} value={k}>{kindLabels[k]}</option>)}</select><ChevronDown size={15} aria-hidden="true" className="generator-select-chevron"/></div><button type="button" className="btn secondary" disabled={!canAdd||locked} onClick={addCustom}><Plus size={15}/> Add</button></div>
          <p>{choices.length>=MAX_ACTIVITY_TYPES?'Maximum 10 activity types per generation.':custom.trim()&&!canAdd?'Choose a unique activity name.':'Custom activities apply to the selected weeks.'}</p>
        </fieldset>
        <fieldset disabled={locked} className="generator-fieldset"><legend>2. Select teaching weeks</legend>
          <label className="generator-radio"><input type="radio" name="generator-weeks" checked={mode==='all'} onChange={()=>setMode('all')}/>All {course.week_count} teaching weeks</label>
          <label className="generator-radio"><input type="radio" name="generator-weeks" checked={mode==='specific'} onChange={()=>setMode('specific')}/>Select specific weeks</label>
          {mode==='specific'&&<><div className="generator-tools"><span>{weeks.length} of {course.week_count} selected</span><button type="button" className="btn secondary small" onClick={()=>setSelectedWeeks(allWeeks)}>All</button><button type="button" className="btn secondary small" onClick={()=>setSelectedWeeks([])}>Clear</button></div><div className="generator-weeks">{allWeeks.map(w=><button key={w} type="button" className="btn secondary small" aria-label={`Week ${w}`} aria-pressed={weeks.includes(w)} onClick={()=>setSelectedWeeks(rows=>rows.includes(w)?rows.filter(n=>n!==w):[...rows,w])}>{w}</button>)}</div></>}
        </fieldset>
      </div>
      <footer className="generator-footer">{failed&&<p role="alert" className="generator-error">Could not confirm the save. Your selections are kept; retrying will only create missing activities.</p>}<div className="generator-summary" aria-live="polite"><strong>Generation summary</strong><div><span>Activity types</span><b>{activities.length}</b></div><div><span>Teaching weeks</span><b>{weeks.length}</b></div><div><span>Potential activities</span><b>{summary.potential}</b></div><div><span>Existing activities to skip</span><b>{summary.skipped}</b></div><div className="generator-total"><span>New activities</span><b>{summary.created}</b></div></div><p>Existing work, dates and linked documents will be preserved.</p><div className="generator-buttons"><button type="button" className="btn secondary" disabled={locked} onClick={onClose}>{offerSetup?'Skip for now':'Cancel'}</button><button type="button" className="btn primary" disabled={locked||!summary.created} aria-busy={saving} onClick={()=>void submit()}>{saving?<><LoaderCircle size={16} className="spin"/> Generating…</>:summary.created?`Generate ${summary.created} activities`:summary.potential?'All selected activities already exist':'Select activities and weeks'}</button></div></footer>
    </>}
  </dialog>;
}
