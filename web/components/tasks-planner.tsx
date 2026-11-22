'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2, Clock3, GripVertical, ListTodo, LoaderCircle, Plus, Repeat2, Timer, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { MutationHint } from '@/lib/snapshot-cache';
import { Badge, Card, DayStatus, EmptyState, FormRow } from '@/components/common';
import { formatDate, kindLabels, localToday, type Course, type Item, type Priority } from '@/lib/types';
import { canPlanOnDate, isOverdue, todayPriorities, upcomingWork, shiftCalendarMonth } from '@/lib/task-view';

type Repeat = 'none'|'daily'|'weekly'|'monthly';
type Mode = 'today'|'upcoming'|'calendar'|'completed';
type Draft = {title:string;course_id:string;kind:string;week_number:string;planned_date:string;due_date:string;priority:Priority;repeat:Repeat;notes:string;submitted:boolean};
const blank = (today:string):Draft=>({title:'',course_id:'',kind:'personal',week_number:'',planned_date:today,due_date:'',priority:'medium',repeat:'none',notes:'',submitted:false});
const dateKey = (d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const asDate = (s:string)=>new Date(s+'T12:00:00');
const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const cadenceLabel:Record<Repeat,string>={none:'Does not repeat',daily:'Daily',weekly:'Weekly',monthly:'Monthly'};
const fullLabel=(d:string)=>new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(asDate(d));

function monthDays(year:number,month:number){
  const first=new Date(year,month,1,12);
  first.setDate(first.getDate()-(first.getDay()+6)%7);
  return Array.from({length:42},(_,i)=>{const d=new Date(first);d.setDate(first.getDate()+i);return {key:dateKey(d),outside:d.getMonth()!==month,day:d.getDate()};});
}

export function TasksPlanner({items,courses,user,busy,pendingItems,run,onToggle,onFocus,onOpenResource,createOpen,setCreateOpen,calendarJump,calendarOnly=false,initialTaskMode='today',taskJump,onTaskJumpHandled}:{
  items:Item[];courses:Course[];user:User|null;busy:boolean;pendingItems:ReadonlySet<string>;
  run:(fn:()=>Promise<unknown>,mutation?:MutationHint)=>Promise<boolean>;
  onToggle:(item:Item)=>void;onFocus:(item:Item)=>void;onOpenResource:(item:Item)=>void;
  createOpen:boolean;setCreateOpen:(value:boolean)=>void;
  calendarJump?:{date:string;token:number}|null;
  calendarOnly?:boolean;
  initialTaskMode?:'today'|'upcoming'|'completed';
  taskJump?:{id:string;token:number}|null;
  onTaskJumpHandled?:()=>void;
}){
  const today=localToday();
  const [mode,setMode]=useState<Mode>(calendarOnly?'calendar':initialTaskMode);
  const [selectedDay,setSelectedDay]=useState(today);
  const [month,setMonth]=useState(()=>{const d=asDate(today);return {year:d.getFullYear(),index:d.getMonth()};});
  const [selectedCourse,setSelectedCourse]=useState('all');
  const [draft,setDraft]=useState<Draft>(()=>blank(today));
  const [editing,setEditing]=useState<Item|null>(null);
  const [hoverDay,setHoverDay]=useState('');
  const [draggedTaskId,setDraggedTaskId]=useState<string|null>(null);
  const [dragNotice,setDragNotice]=useState('');
  const [showInbox,setShowInbox]=useState(true);
  // Personal-deadline deep links highlight a task without opening its edit form.
  const [highlightedTask,setHighlightedTask]=useState<string|null>(null);
  const highlightedRef=useRef<HTMLDivElement|null>(null);
  const availableCourses=courses.filter(c=>!c.archived);
  const filtered=items.filter(i=>selectedCourse==='all'||(selectedCourse==='personal'?!i.course_id:i.course_id===selectedCourse));
  const open=filtered.filter(i=>!i.done);
  const overdue=open.filter(i=>isOverdue(i,today));
  const plannedToday=open.filter(i=>i.planned_date===today);
  const sortByDate=(a:Item,b:Item)=>(a.planned_date||a.due_date||'9999').localeCompare(b.planned_date||b.due_date||'9999') || a.title.localeCompare(b.title);
  const listed=mode==='completed'?filtered.filter(i=>i.done).sort((a,b)=>(b.planned_date||'').localeCompare(a.planned_date||'')):
    mode==='today'?todayPriorities(filtered,today):upcomingWork(filtered,today).sort(sortByDate);
  const monthCells=useMemo(()=>monthDays(month.year,month.index),[month.year,month.index]);
  const scheduled=filtered.filter(i=>i.planned_date===selectedDay);
  // Work planned and due on the same date is shown once in the agenda.
  const due=filtered.filter(i=>i.due_date===selectedDay&&i.planned_date!==selectedDay);
  const inbox=open.filter(i=>!i.planned_date);
  const calendarBuckets=useMemo(()=>{
    const map=new Map<string,{planned:number;due:number}>();
    for(const item of filtered){
      if(item.planned_date){const b=map.get(item.planned_date)||{planned:0,due:0};b.planned++;map.set(item.planned_date,b);}
      if(item.due_date){const b=map.get(item.due_date)||{planned:0,due:0};b.due++;map.set(item.due_date,b);}
    }
    return map;
  },[filtered]);
  const changeMonth=(offset:number)=>{
    const nextDay=shiftCalendarMonth(selectedDay,offset);
    const d=asDate(nextDay);
    setSelectedDay(nextDay);
    setMonth({year:d.getFullYear(),index:d.getMonth()});
  };
  const selectCalendarDay=(key:string)=>{
    setSelectedDay(key);
    const d=asDate(key);
    setMonth({year:d.getFullYear(),index:d.getMonth()});
  };
  const gotoToday=()=>{setSelectedDay(today);const d=asDate(today);setMonth({year:d.getFullYear(),index:d.getMonth()});};
  const openEdit=(item:Item)=>{setCreateOpen(false);setEditing(item);setDraft({title:item.title,course_id:item.course_id||'',kind:item.kind,week_number:item.week_number?String(item.week_number):'',planned_date:item.planned_date||'',due_date:item.due_date||'',priority:item.priority,repeat:item.repeat||'none',notes:item.notes||'',submitted:item.submitted});};
  // Deep links from Home continue working when this component mounts after a tab change.
  useEffect(()=>{
    if(!calendarOnly||!calendarJump?.date)return;
    selectCalendarDay(calendarJump.date);
  },[calendarOnly,calendarJump?.token]);
  useEffect(()=>{
    if(!taskJump)return;
    const target=items.find(i=>i.id===taskJump.id);
    if(target){setMode(initialTaskMode);setSelectedCourse(target.course_id||'personal');setHighlightedTask(target.id);}
    onTaskJumpHandled?.();
  },[taskJump?.token]);
  useEffect(()=>{if(highlightedTask)highlightedRef.current?.scrollIntoView({behavior:'smooth',block:'center'});},[highlightedTask,mode,selectedCourse]);
  const startCreate=(date?:string)=>{setEditing(null);setDraft(blank(date||today));setCreateOpen(true);};
  const closeForm=()=>{setEditing(null);setCreateOpen(false);};
  const save=async(e:FormEvent)=>{
    e.preventDefault();
    if(!draft.title.trim())return;
    if(draft.repeat!=='none'&&!draft.planned_date)return;
    if(draft.planned_date&&draft.due_date&&draft.planned_date>draft.due_date)return;
    const itemKind=draft.course_id?(draft.kind==='personal'?'revision':draft.kind):'personal';
    const payload={title:draft.title.trim(),planned_date:draft.planned_date||null,due_date:draft.due_date||null,
      priority:draft.priority,notes:draft.notes,repeat:itemKind==='assignment'?'none':draft.repeat};
    const ok=await run(()=>editing
      ?api(`/api/items/${editing.id}`,user,{method:'PATCH',body:{...payload,submitted:editing.kind==='assignment'?draft.submitted:undefined}})
      :api('/api/items',user,{method:'POST',body:{...payload,kind:itemKind,course_id:draft.course_id||null,
        week_number:draft.course_id&&draft.week_number?Number(draft.week_number):null,is_task:true}}),{collection:'items'});
    if(ok){closeForm();setDraft(blank(today));}
  };
  const reschedule=async(id:string,date:string)=>{
    const item=items.find(i=>i.id===id);
    if(!item||item.done||busy||pendingItems.has(id))return;
    if(!canPlanOnDate(item,date)){
      setDragNotice(`Cannot schedule “${item.title}” after its deadline (${formatDate(item.due_date!)}).`);
      return;
    }
    setDragNotice('');
    await run(()=>api(`/api/items/${id}`,user,{method:'PATCH',body:{planned_date:date}}),{collection:'items'});
  };
  const drop=(e:DragEvent<HTMLButtonElement>,date:string)=>{
    e.preventDefault();setHoverDay('');setDraggedTaskId(null);
    const id=e.dataTransfer.getData('text/plain');
    if(id)void reschedule(id,date);
  };
  const remove=async(item:Item)=>{
    if(!window.confirm(`Delete “${item.title}”? This removes the task, not its course or PDFs.`))return;
    await run(()=>api(`/api/items/${item.id}`,user,{method:'DELETE'}),{collection:'items',deleteId:item.id});
    closeForm();
  };
  const formDateInvalid=Boolean(draft.planned_date&&draft.due_date&&draft.planned_date>draft.due_date);
  const draggedTask=draggedTaskId?items.find(i=>i.id===draggedTaskId):null;
  const formVisible=createOpen||editing!==null;
  const formCourse=availableCourses.find(c=>c.id===draft.course_id);
  const showRow=(i:Item,drag=false)=>{
    const course=availableCourses.find(c=>c.id===i.course_id);
    return <div className={'planner-v05-task'+(isOverdue(i,today)?' planner-task-overdue':'')+(highlightedTask===i.id?' planner-target-item':'')} ref={highlightedTask===i.id?highlightedRef:undefined} key={i.id} draggable={drag&&!busy&&!i.done&&!pendingItems.has(i.id)} aria-busy={pendingItems.has(i.id)}
        onDragStart={e=>{if(drag){e.dataTransfer.setData('text/plain',i.id);e.dataTransfer.effectAllowed='move';setDraggedTaskId(i.id);setDragNotice('');}}}
        onDragEnd={()=>{setDraggedTaskId(null);setHoverDay('');}}>
      {drag&&<GripVertical className="planner-v05-drag" size={15} aria-hidden="true"/>}
      <input type="checkbox" checked={i.done} disabled={busy||pendingItems.has(i.id)} aria-label={`Complete ${i.title}`} onChange={()=>onToggle(i)}/>
      <div className="planner-v05-taskbody"><strong className={i.done?'complete':''}>{i.title}</strong>
        <div className="planner-v05-tags"><span>{course?.code||'Personal'}</span>{i.kind==='assignment'&&<span>Assignment</span>}
          {isOverdue(i,today)&&<span className="planner-overdue-tag"><AlertTriangle size={12}/> Overdue</span>}{i.priority==='high'&&<span className="priority">High priority</span>}
          {i.repeat&&i.repeat!=='none'&&<span><Repeat2 size={12}/> {cadenceLabel[i.repeat]}</span>}
        </div><DayStatus i={i}/>
      </div>
      <div className="planner-v05-row-actions">
        <button className="btn secondary small" disabled={busy||pendingItems.has(i.id)} onClick={()=>openEdit(i)}>Edit</button>
        {i.resource_id&&<button className="icon-btn" disabled={busy} title="Open linked notes or textbook" aria-label={`Open resource for ${i.title}`} onClick={()=>onOpenResource(i)}><BookOpen size={16}/></button>}
        <button className="icon-btn" disabled={busy||i.done} title="Focus on this task" aria-label={`Focus on ${i.title}`} onClick={()=>onFocus(i)}><Timer size={16}/></button>
      </div>
    </div>;
  };
  return <>
    <div className="page-heading"><div><span className="eyebrow"><CalendarDays size={13}/> {calendarOnly?'YOUR STUDY CALENDAR':'YOUR TASKS & PLANS'}</span><h1>{calendarOnly?'Calendar':'Tasks'}</h1></div>
      <button className="btn primary" onClick={()=>startCreate(mode==='calendar'?selectedDay:today)}><Plus size={16}/> New task</button></div>
    <div className="planner-v05-summary">
      <div><span>Planned today</span><strong>{plannedToday.length}</strong></div>
      <div><span>Upcoming deadlines</span><strong>{open.filter(i=>i.due_date&&i.due_date>=today).length}</strong></div>
      <div className={overdue.length?'planner-overdue-summary':''}><span>Overdue</span><strong className={overdue.length?'danger':''}>{overdue.length}</strong></div>
    </div>
    <Card className="planner-v05-shell">
      <div className="planner-v05-toolbar">
        {!calendarOnly&&<div className="segmented">{(['today','upcoming','completed'] as const).map(m=><button key={m} className={mode===m?'selected':''} onClick={()=>setMode(m)}>{m==='today'?'Today':m==='upcoming'?'Upcoming':'Completed'}</button>)}</div>}
        <label className="planner-v05-filter"><span>Show</span><select value={selectedCourse} onChange={e=>setSelectedCourse(e.target.value)}><option value="all">All tasks</option><option value="personal">Personal only</option>{availableCourses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></label>
      </div>
      {mode==='calendar'?<div className="planner-v05-calendar-layout"><div>
        <div className="planner-v05-calendar-heading"><h3>{new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric'}).format(new Date(month.year,month.index,1))}</h3>
          <div className="planner-v05-cal-nav"><button className="btn secondary small" onClick={()=>changeMonth(-1)} aria-label="Previous month"><ArrowLeft size={16}/></button><button className="btn secondary small" onClick={gotoToday}>Today</button><button className="btn secondary small" onClick={()=>changeMonth(1)} aria-label="Next month"><ArrowRight size={16}/></button></div></div>
        <div className="planner-v05-weekdays">{days.map(day=><span key={day}>{day}</span>)}</div>
        <div className="planner-v05-grid">{monthCells.map(day=>{
          const counts=calendarBuckets.get(day.key);
          const blocked=draggedTask&&!canPlanOnDate(draggedTask,day.key);
          return <button key={day.key} className={`planner-v05-day ${day.outside?'outside':''} ${day.key===today?'today':''} ${day.key===selectedDay?'selected':''} ${draggedTask&&hoverDay===day.key?(blocked?'drop-blocked':'drop-target'):''}`}
            title={blocked?`Cannot plan after ${formatDate(draggedTask!.due_date!)}`:`Select ${fullLabel(day.key)}; drop tasks here to plan them`} aria-label={`${fullLabel(day.key)} — ${counts?.planned||0} planned, ${counts?.due||0} due${blocked?' — after task deadline':''}`}
            onClick={()=>selectCalendarDay(day.key)}
            onDragOver={e=>{if(draggedTask){e.preventDefault();e.dataTransfer.dropEffect=blocked?'none':'move';setHoverDay(previous=>previous===day.key?previous:day.key);}}}
            onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setHoverDay(previous=>previous===day.key?'':previous);}}
            onDrop={e=>drop(e,day.key)}>
            <span className="planner-v05-day-number">{day.day}</span>
            <div className="planner-v05-day-markers">{!!counts?.planned&&<span className="planned">{counts.planned} plan</span>}{!!counts?.due&&<span className="due">{counts.due} due</span>}</div>
          </button>;
        })}</div>
        <p className="planner-v05-hint">Drag tasks to schedule. Use Edit on mobile.</p>
        {draggedTask&&hoverDay&&!canPlanOnDate(draggedTask,hoverDay)&&<p role="status" className="planner-v05-drop-notice"><AlertTriangle size={15} aria-hidden="true"/> Cannot plan after {formatDate(draggedTask.due_date!)}. Choose an earlier day.</p>}
        {dragNotice&&<p role="alert" className="planner-v05-drop-notice"><AlertTriangle size={15} aria-hidden="true"/> {dragNotice}</p>}
      </div><div className="planner-v05-agenda"><div className="planner-v05-agenda-title"><div><span>SELECTED DAY</span><h3>{fullLabel(selectedDay)}</h3></div><button className="icon-btn" onClick={()=>startCreate(selectedDay)} aria-label="Add task for this day"><Plus size={18}/></button></div>
        <h4>Planned work <span>{scheduled.length}</span></h4>{scheduled.length?scheduled.map(i=>showRow(i,true)):<p className="planner-v05-hint">Nothing planned. Drop a task here or add a new one.</p>}
        <h4>Due on this day <span>{due.length}</span></h4>{due.length?due.map(i=><button type="button" key={i.id} className="planner-v05-due" onClick={()=>openEdit(i)} title={`Open ${i.title}`} aria-label={`Open task ${i.title}`}><Clock3 size={15}/><span>{i.title}</span>{i.done&&<CheckCircle2 size={14}/>}<ArrowRight size={14}/></button>):<p className="planner-v05-hint">No additional deadlines on this date.</p>}
        <button className="planner-v05-inbox-toggle" onClick={()=>setShowInbox(!showInbox)}>{showInbox?'Hide':'Show'} unscheduled tasks ({inbox.length})</button>
        {showInbox&&<div className="planner-v05-inbox">{inbox.length?inbox.map(i=>showRow(i,true)):<p className="planner-v05-hint">Your inbox is clear.</p>}</div>}
      </div></div>:<div className="planner-v05-list"><div className="planner-v05-list-heading"><h3>{mode==='today'?"Today's priorities":mode==='upcoming'?'Upcoming & unscheduled':'Completed tasks'}</h3><span>{listed.length} tasks</span></div>
        {listed.length?listed.map(i=>showRow(i)):<EmptyState icon={<ListTodo size={24}/>} title="All caught up" detail={mode==='completed'?'Complete a task to see it here.':'Choose a study assignment or add a personal task to start planning.'}/>}
      </div>}
    </Card>
    {formVisible&&<div className="planner-v05-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)closeForm();}}>
      <div className="planner-v05-dialog" role="dialog" aria-modal="true" aria-label={editing?'Edit task':'Create task'}>
        <div className="planner-v05-dialoghead"><div><span className="eyebrow">{editing?'EDIT YOUR PLAN':'NEW TASK'}</span><h2>{editing?'Edit task':'New task'}</h2></div><button className="icon-btn" disabled={busy} onClick={closeForm} aria-label="Close"><X size={18}/></button></div>
        <form onSubmit={e=>void save(e)} className="planner-v05-form"><FormRow label="Task title"><input required autoFocus value={draft.title} onChange={e=>setDraft(p=>({...p,title:e.target.value}))} placeholder="What needs to be done?"/></FormRow>
          {!editing&&<FormRow label="Belongs to"><select value={draft.course_id} onChange={e=>setDraft(p=>({...p,course_id:e.target.value,kind:e.target.value?'revision':'personal',week_number:'',repeat:'none'}))}><option value="">Personal task</option>{availableCourses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></FormRow>}
          {!editing&&draft.course_id&&<div className="planner-v05-form-columns"><FormRow label="Study activity"><select value={draft.kind} onChange={e=>setDraft(p=>({...p,kind:e.target.value,repeat:e.target.value==='assignment'?'none':p.repeat}))}>{['revision','reading','notes','assignment'].map(k=><option key={k} value={k}>{kindLabels[k as keyof typeof kindLabels]}</option>)}</select></FormRow><FormRow label="Teaching week (optional)"><select value={draft.week_number} onChange={e=>setDraft(p=>({...p,week_number:e.target.value}))}><option value="">Whole course</option>{Array.from({length:formCourse?.week_count||0},(_,i)=><option key={i+1} value={i+1}>Week {i+1}</option>)}</select></FormRow></div>}
          {editing&&<p className="planner-v05-hint">{editing.course_id?`Linked to ${availableCourses.find(c=>c.id===editing.course_id)?.code||'course'}${editing.week_number?` · Week ${editing.week_number}`:''}`:'Personal task'} — editing its date or completion here updates the same task in Study.</p>}
          <div className="planner-v05-form-columns"><FormRow label="Planned work date"><input type="date" max={draft.due_date||undefined} value={draft.planned_date} onChange={e=>setDraft(p=>({...p,planned_date:e.target.value}))}/></FormRow><FormRow label="Due date (optional)"><input type="date" min={draft.planned_date||undefined} value={draft.due_date} onChange={e=>setDraft(p=>({...p,due_date:e.target.value}))}/></FormRow></div>
          {formDateInvalid&&<p role="alert" className="planner-v05-drop-notice"><AlertTriangle size={15}/> Planned date cannot be after the deadline.</p>}
          <div className="planner-v05-form-columns"><FormRow label="Priority"><select value={draft.priority} onChange={e=>setDraft(p=>({...p,priority:e.target.value as Priority}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></FormRow><FormRow label="Repeat after completion"><select value={draft.repeat} disabled={(editing?.kind||draft.kind)==='assignment'} onChange={e=>setDraft(p=>({...p,repeat:e.target.value as Repeat}))}>{Object.entries(cadenceLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></FormRow></div>
          {draft.repeat!=='none'&&<p className="planner-v05-hint"><Repeat2 size={13}/> When you complete this task, a new one will be scheduled for the next {draft.repeat==='daily'?'day':draft.repeat==='weekly'?'week':'month'}. No background tasks are generated.</p>}
          <FormRow label="Notes (optional)"><textarea rows={3} value={draft.notes} onChange={e=>setDraft(p=>({...p,notes:e.target.value}))} placeholder="Details, checklist notes or reference links"/></FormRow>
          {editing?.kind==='assignment'&&<label className="planner-v05-submitted"><input type="checkbox" checked={draft.submitted} onChange={e=>setDraft(p=>({...p,submitted:e.target.checked}))}/> Officially submitted</label>}
          <div className="planner-v05-formactions">{editing&&<button type="button" className="btn secondary planner-v05-delete" disabled={busy} onClick={()=>void remove(editing)}><Trash2 size={15}/> Delete</button>}
            <button type="button" className="btn secondary" disabled={busy} onClick={closeForm}>Cancel</button><button className="btn primary" disabled={busy||formDateInvalid||!draft.title.trim()||(draft.repeat!=='none'&&!draft.planned_date)} aria-busy={busy}>{busy&&<LoaderCircle className="spin" size={14}/>} {busy?'Saving…':editing?'Save changes':'Create task'}</button></div>
        </form>
      </div>
    </div>}
  </>;
}
