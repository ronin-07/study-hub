'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  Archive, ArrowRight, BookMarked, BookOpen, CalendarDays, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, Cloud, ExternalLink, FileText, FolderOpen, GraduationCap,
  Library, ListChecks, ListFilter, LoaderCircle, NotebookPen, Pencil, Plus, RotateCcw, Timer, X
} from 'lucide-react';
import { api } from '@/lib/api';
import type { MutationHint } from '@/lib/snapshot-cache';
import { Badge, Card, EmptyState, FormRow, SectionTitle } from '@/components/common';
import { isActionable, isOverdue } from '@/lib/task-view';
import { resolveWorkspaceSemester } from '@/lib/course-navigation';
import { type Course, type Item, type Resource, type Semester, type Snapshot, formatDate, kindLabels, localToday } from '@/lib/types';

type SemesterOption = { key: string; name: string; id: string | null; registered: boolean };
type WorkspaceTab = 'overview' | 'course-library' | 'week-resources' | 'tasks' | 'exam';
type ResourceKind = Resource['kind'];
type Dialog = 'semester' | 'course' | 'archive' | 'resource' | 'item' | 'edit-note' | 'plan-item' | 'week' | null;
type CourseDraft = { code: string; title: string; semester_key: string; week_count: number; exam_date: string; goals: string };
type ResourceDraft = { title: string; kind: ResourceKind; source: 'link' | 'dtu'; url: string; chapter: string; page_start: string; page_end: string; item_id: string };
type ItemDraft = { title: string; notes: string; kind: Item['kind']; is_task: boolean; planned_date: string; due_date: string; chapter: string; page_start: string; page_end: string; resource_id: string };

const courseDraftDefaults: CourseDraft = { code: '', title: '', semester_key: '', week_count: 13, exam_date: '', goals: '' };
const resourceDraftDefaults: ResourceDraft = { title: '', kind: 'slides', source: 'dtu', url: '', chapter: '', page_start: '', page_end: '', item_id: '' };
const itemDraftDefaults: ItemDraft = { title: '', notes: '', kind: 'lecture', is_task: false, planned_date: '', due_date: '', chapter: '', page_start: '', page_end: '', resource_id: '' };

function makeSemesters(data: Snapshot): SemesterOption[] {
  return (data.semesters || []).map(s => ({ key: `id:${s.id}`, name: s.name, id: s.id, registered: true }));
}
function courseSemester(course: Course, semesters: SemesterOption[]): string {
  const byId = semesters.find(s => s.id && s.id === course.semester_id);
  return byId?.key || '';
}
function numberOrNull(value: string) { return value.trim() ? Number(value) : null; }

interface Props {
  data: Snapshot;
  user: User | null;
  busy: boolean;
  pendingItems: ReadonlySet<string>;
  completingIds: ReadonlySet<string>;
  exitingIds: ReadonlySet<string>;
  courseId: string;
  weekNumber: number;
  landingItem?: { id: string; weekNumber: number | null } | null;
  selectCourse: (id: string) => void;
  selectWeek: (week: number) => void;
  run: (operation: () => Promise<unknown>, mutation?: MutationHint) => Promise<boolean>;
  toggleItem: (item: Item) => void;
  focusOn: (item: Item) => void;
  openResource: (resource: Resource) => void;
  openDrive: (courseId: string, weekNumber: number, kind: ResourceKind, scope: 'course' | 'week') => void;
}

/** Single registered semester -> course -> week navigation source of truth. */
export function CoursePlanner({ data, user, busy, pendingItems, completingIds, exitingIds, courseId, weekNumber, selectCourse, selectWeek, run, toggleItem, focusOn, openResource, openDrive, landingItem }: Props) {
  const semesterOptions = useMemo(() => makeSemesters(data), [data]);
  const [semesterKey, setSemesterKey] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [semestersExpanded, setSemestersExpanded] = useState(true);
  const [openSemesterKeys, setOpenSemesterKeys] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState<'all'|'planned'|'due'|'completed'>('all');
  const [noteDraft, setNoteDraft] = useState({ id:'', title:'', notes:'' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [semesterTreeReady, setSemesterTreeReady] = useState(false);
  const lastCourseNavigationRef = useRef(courseId);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(()=>landingItem && landingItem.weekNumber===null?'tasks':'overview');
  const landingRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{landingRef.current?.scrollIntoView({behavior:'smooth',block:'center'});},[landingItem?.id,workspaceTab]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editCourseId, setEditCourseId] = useState('');
  const [courseDraft, setCourseDraft] = useState<CourseDraft>(courseDraftDefaults);
  const [semDraft, setSemDraft] = useState({ id: '', name: '', start_date: '', end_date: '' });
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft>(resourceDraftDefaults);
  const [resourceScope, setResourceScope] = useState<'course' | 'week'>('course');
  const [resourceEditId, setResourceEditId] = useState('');
  const [itemDraft, setItemDraft] = useState<ItemDraft>(itemDraftDefaults);
  const [planItemId, setPlanItemId] = useState('');
  const [planDate, setPlanDate] = useState('');
  const [weekDraft, setWeekDraft] = useState({ title: '', objectives: '' });
  const [examTitle, setExamTitle] = useState('');

  // The parent course selection is authoritative (e.g. Home -> Open course).
  // Keep local semester selection when there is no selected course, such as an empty semester.
  const requestedCourse = data.courses.find(c => c.id === courseId);
  const requestedSemesterKey = requestedCourse ? courseSemester(requestedCourse, semesterOptions) : '';
  useEffect(()=>{
    // Only the selected semester is expanded initially. Persist explicit disclosures
    // when switching between Study and the rest of the app.
    try {
      const stored=window.localStorage.getItem('studyhub-expanded-semesters');
      const parsed=stored?JSON.parse(stored):null;
      if(Array.isArray(parsed))setOpenSemesterKeys(parsed.filter((key):key is string=>typeof key==='string'));
      else setOpenSemesterKeys((requestedSemesterKey||semesterOptions[0]?.key)?[requestedSemesterKey||semesterOptions[0].key]:[]);
    }catch{setOpenSemesterKeys((requestedSemesterKey||semesterOptions[0]?.key)?[requestedSemesterKey||semesterOptions[0].key]:[]);}
    setSemesterTreeReady(true);
  // Initialize only on mount; explicit user collapse choices should not be reset.
  },[]);
  useEffect(()=>{
    if(!semesterTreeReady)return;
    if(lastCourseNavigationRef.current!==courseId){
      lastCourseNavigationRef.current=courseId;
      if(requestedSemesterKey)setOpenSemesterKeys(keys=>keys.includes(requestedSemesterKey)?keys:[...keys,requestedSemesterKey]);
    }
  },[courseId,requestedSemesterKey,semesterTreeReady]);
  useEffect(()=>{
    if(semesterTreeReady)window.localStorage.setItem('studyhub-expanded-semesters',JSON.stringify(openSemesterKeys));
  },[openSemesterKeys,semesterTreeReady]);
  const toggleSemester=(key:string)=>setOpenSemesterKeys(keys=>keys.includes(key)?keys.filter(existing=>existing!==key):[...keys,key]);
  const currentSemesterKey = resolveWorkspaceSemester(semesterOptions.map(s => s.key), semesterKey, requestedSemesterKey);
  const semester = semesterOptions.find(s => s.key === currentSemesterKey);
  const matching = data.courses.filter(c => courseSemester(c, semesterOptions) === currentSemesterKey);
  const visible = matching.filter(c => Boolean(c.archived) === showArchived);
  const selected = visible.find(c => c.id === courseId) || visible[0];
  const selectedId = selected?.id || '';
  const activeCount = matching.filter(c => !c.archived).length;
  const archivedCount = matching.filter(c => c.archived).length;
  const week = data.weeks.find(w => w.course_id === selectedId && w.number === weekNumber);
  const items = data.items.filter(i => i.course_id === selectedId && i.week_number === weekNumber);
  const shared = data.resources.filter(r => r.course_id === selectedId && (r.week_number === null || r.week_number === undefined));
  const weekResources = data.resources.filter(r => r.course_id === selectedId && r.week_number === weekNumber);
  const courseItems = data.items.filter(i => i.course_id === selectedId);
  const examItems = courseItems.filter(i => i.week_number === null && i.kind === 'revision');
  const courseDoneCount=courseItems.filter(i=>i.done).length;
  const courseCompletion=courseItems.length?Math.round(100*courseDoneCount/courseItems.length):0;
  const weekNotes=items.filter(i=>i.kind==='notes');
  const today=localToday();
  const filteredItems=items.filter(i=>activityFilter==='all'||(activityFilter==='completed'?i.done:!i.done&&(activityFilter==='planned'?Boolean(i.planned_date):Boolean(i.due_date))));
  const isReadOnly = Boolean(selected?.archived);
  // Never carry a previous course or week's activity filter into a new workspace.
  useEffect(()=>{setActivityFilter('all');setFiltersOpen(false);},[selectedId,weekNumber]);

  useEffect(() => {
    if (selected && weekNumber > selected.week_count) selectWeek(selected.week_count);
  }, [selected?.id, selected?.week_count, weekNumber, selectWeek]);

  const chooseSemester = (key: string) => {
    setSemesterKey(key); setShowArchived(false); setWorkspaceTab('overview'); selectWeek(1);
    setOpenSemesterKeys(keys=>keys.includes(key)?keys:[...keys,key]);
    const next = data.courses.find(c => courseSemester(c, semesterOptions) === key && !c.archived);
    selectCourse(next?.id || '');
  };
  const onSemesterRowClick = (key: string) => {
    // Clicking the selected semester again closes it; chevron and label agree.
    if (key === currentSemesterKey) toggleSemester(key);
    else chooseSemester(key);
  };
  const chooseCourse = (course: Course) => {
    const key=courseSemester(course,semesterOptions);
    setSemesterKey(key);
    setShowArchived(Boolean(course.archived));
    setOpenSemesterKeys(keys=>keys.includes(key)?keys:[...keys,key]);
    selectCourse(course.id); selectWeek(1); setWorkspaceTab('overview');
  };
  const openCourseForm = (course?: Course) => {
    setEditCourseId(course?.id || '');
    setCourseDraft(course ? {
      code: course.code, title: course.title, semester_key: courseSemester(course, semesterOptions),
      week_count: course.week_count, exam_date: course.exam_date || '', goals: course.goals || ''
    } : { ...courseDraftDefaults, semester_key: currentSemesterKey });
    setDialog('course');
  };
  const editSemester = (s?: Semester) => {
    setSemDraft({ id: s?.id || '', name: s?.name || '', start_date: s?.start_date || '', end_date: s?.end_date || '' });
    setDialog('semester');
  };
  const saveSemester = async (e: FormEvent) => {
    e.preventDefault();
    const payload = { name: semDraft.name, start_date: semDraft.start_date || null, end_date: semDraft.end_date || null };
    let saved: Semester | null = null;
    const ok = await run(async () => {
      saved = await api<Semester>(semDraft.id ? `/api/semesters/${semDraft.id}` : '/api/semesters', user,
        { method: semDraft.id ? 'PATCH' : 'POST', body: payload });
    });
    if (ok) { if (saved) setSemesterKey(`id:${(saved as Semester).id}`); setDialog(null); }
  };
  const saveCourse = async (e: FormEvent) => {
    e.preventDefault();
    const target = semesterOptions.find(s => s.key === courseDraft.semester_key);
    if (!target) return;
    let saved: Course | null = null;
    const payload = { code: courseDraft.code.trim(), title: courseDraft.title.trim(),
      semester_id: target.id, semester: target.name, week_count: courseDraft.week_count,
      exam_date: courseDraft.exam_date || null, goals: courseDraft.goals };
    const ok = await run(async () => {
      saved = await api<Course>(editCourseId ? `/api/courses/${editCourseId}` : '/api/courses', user,
        { method: editCourseId ? 'PATCH' : 'POST', body: payload });
      return saved;
    },{collection:'courses'});
    if (ok) { setDialog(null); setSemesterKey(target.key); setShowArchived(false); if (saved) selectCourse((saved as Course).id); selectWeek(1); }
  };
  const archive = async () => {
    if (!selected) return;
    const ok = await run(() => api(`/api/courses/${selected.id}/archive`, user, { method:'POST' }),{collection:'courses'});
    if (ok) { setDialog(null); setShowArchived(false); selectCourse(matching.find(c => c.id !== selected.id && !c.archived)?.id || ''); }
  };
  const restore = async (course: Course) => {
    const ok = await run(() => api(`/api/courses/${course.id}/restore`, user, { method:'POST' }),{collection:'courses'});
    if (ok) { setShowArchived(false); selectCourse(course.id); setWorkspaceTab('overview'); }
  };
  const saveWeek = async (e: FormEvent) => {
    e.preventDefault(); if (!selected) return;
    const ok = await run(() => api(week ? `/api/weeks/${week.id}` : '/api/weeks', user, {
      method: week ? 'PATCH' : 'POST', body: week ? weekDraft : { ...weekDraft, course_id:selected.id, number:weekNumber }
    }),{collection:'weeks'});
    if (ok) setDialog(null);
  };
  const startNote = () => {
    setItemDraft({...itemDraftDefaults,kind:'notes',is_task:false});
    setDialog('item');
  };
  const editNote = (item: Item) => {
    setNoteDraft({id:item.id,title:item.title,notes:item.notes||''});
    setDialog('edit-note');
  };
  const saveNote = async (e:FormEvent) => {
    e.preventDefault();
    if(!noteDraft.id||!noteDraft.title.trim())return;
    const ok=await run(()=>api(`/api/items/${noteDraft.id}`,user,{
      method:'PATCH',body:{title:noteDraft.title.trim(),notes:noteDraft.notes}
    }),{collection:'items'});
    if(ok)setDialog(null);
  };
  const saveItem = async (e: FormEvent) => {
    e.preventDefault(); if (!selected) return;
    if(itemDraft.planned_date&&itemDraft.due_date&&itemDraft.planned_date>itemDraft.due_date)return;
    const payload = { ...itemDraft, course_id: selected.id, week_number:weekNumber,
      is_task: itemDraft.kind === 'assignment' || itemDraft.is_task || !!itemDraft.planned_date,
      planned_date:itemDraft.planned_date || null, due_date:itemDraft.due_date || null,
      resource_id:itemDraft.resource_id || null, page_start:numberOrNull(itemDraft.page_start), page_end:numberOrNull(itemDraft.page_end) };
    const ok=await run(() => api('/api/items', user, { method:'POST', body: payload }),{collection:'items'});
    if (ok) { setDialog(null); setItemDraft(itemDraftDefaults); }
  };
  const planItem = data.items.find(i => i.id === planItemId);
  const openActivityPlan = (item: Item) => {
    setPlanItemId(item.id);
    setPlanDate(item.planned_date || localToday());
    setDialog('plan-item');
  };
  const updateActivityPlan = async (date: string | null) => {
    if (!planItem || busy || (date&&planItem.due_date&&date>planItem.due_date)) return;
    // One item ID remains shared between Week checklist, Tasks, and Home.
    const ok = await run(() => api(`/api/items/${planItem.id}`, user, {
      method:'PATCH', body:{planned_date:date}
    }),{collection:'items'});
    if (ok) setDialog(null);
  };
  const saveExam = async (e: FormEvent) => {
    e.preventDefault(); if (!selected || !examTitle.trim()) return;
    const ok = await run(() => api('/api/items',user,{method:'POST',body:{course_id:selected.id,week_number:null,
      kind:'revision',is_task:true,title:examTitle.trim()}}),{collection:'items'});
    if (ok) setExamTitle('');
  };
  const openResourceForm = (scope: 'course' | 'week', resource?: Resource) => {
    setResourceScope(scope); setResourceEditId(resource?.id || '');
    setResourceDraft(resource ? {title:resource.title,kind:resource.kind,source:resource.source==='dtu'?'dtu':'link',
      url:resource.url || '',chapter:resource.chapter||'',page_start:String(resource.page_start||''),
      page_end:String(resource.page_end||''),item_id:resource.item_id||''} : { ...resourceDraftDefaults,
        kind:scope==='course'?'textbook':'slides' });
    setDialog('resource');
  };
  const saveResource = async (e:FormEvent) => {
    e.preventDefault(); if (!selected) return;
    const base = {title:resourceDraft.title,kind:resourceDraft.kind,chapter:resourceDraft.chapter,
      page_start:numberOrNull(resourceDraft.page_start),page_end:numberOrNull(resourceDraft.page_end),
      week_number:resourceScope==='course'?null:weekNumber,item_id:resourceScope==='course'?null:(resourceDraft.item_id||null)};
    const existing = data.resources.find(r=>r.id===resourceEditId);
    const payload = existing ? base : {...base,course_id:selected.id,source:resourceDraft.source,url:resourceDraft.url};
    const ok = await run(() => api(resourceEditId?`/api/resources/${resourceEditId}`:'/api/resources',user,
      {method:resourceEditId?'PATCH':'POST',body:payload}),{collection:'resources'});
    if (ok) {setDialog(null);setResourceEditId('');}
  };
  const removeResource = async (r:Resource) => {
    if (!confirm(`Remove the Study Hub link to “${r.title}”? Your original PDF in Drive or DTU Learn will not be deleted.`))return;
    await run(() => api(`/api/resources/${r.id}`,user,{method:'DELETE'}),{collection:'resources',deleteId:r.id});
  };
  const deleteItem = async (i:Item) => {
    if (!confirm(`Remove study activity “${i.title}”? Linked resources must be detached first.`)) return;
    await run(() => api(`/api/items/${i.id}`,user,{method:'DELETE'}),{collection:'items',deleteId:i.id});
  };
  const sourceLabel=(r:Resource)=>r.source==='drive'?'Goodnotes / Google Drive':r.source==='dtu'?'DTU Learn':'Web link';
  const resourceRow = (r:Resource) => <div className="planner-file-row" key={r.id}>
    <div className="planner-file-symbol">{r.kind==='textbook'?<BookOpen size={19}/>:r.kind==='handwritten'?<NotebookPen size={19}/>:<FileText size={19}/>}</div>
    <div className="planner-file-details"><strong>{r.title}</strong><small>{sourceLabel(r)} · {r.kind}{r.chapter?` · ${r.chapter}`:''}</small></div>
    <button type="button" className="icon-btn" title="Open resource" onClick={()=>openResource(r)}>{r.source==='drive'?<BookOpen size={17}/>:<ExternalLink size={17}/>}</button>
    {!isReadOnly&&<button type="button" className="icon-btn" title="Edit resource or move to Course Library" onClick={()=>openResourceForm(r.week_number==null?'course':'week',r)}><Pencil size={15}/></button>}
    {!isReadOnly&&<button type="button" className="icon-btn danger-hover" title="Unlink resource" onClick={()=>void removeResource(r)}><X size={15}/></button>}
  </div>;

  const activeSemester = (data.semesters||[]).find(s=>s.id===semester?.id);
  const editingResource = data.resources.find(r=>r.id===resourceEditId);
  const linkedCounts = selected ? {
    items:courseItems.length, documents:data.resources.filter(r=>r.course_id===selected.id).length,
    sessions:data.sessions.filter(s=>s.course_id===selected.id).length
  } : {items:0,documents:0,sessions:0};

  const weekPicker=<div className="planner-week-picker">
    <span className="planner-week-label">Teaching week</span>
    <button className="btn secondary small" aria-label="Previous week" disabled={weekNumber<=1} onClick={()=>selectWeek(weekNumber-1)}><ChevronLeft size={17}/></button>
    <span className="planner-week-select-wrap"><select aria-label="Teaching week" title="Jump to a teaching week" value={weekNumber} onChange={e=>selectWeek(Number(e.target.value))}>{Array.from({length:selected?.week_count||1},(_,idx)=><option key={idx+1} value={idx+1}>Week {idx+1}</option>)}</select><ChevronDown size={16} strokeWidth={2} aria-hidden="true" className="planner-week-select-chevron"/></span>
    <button className="btn secondary small" aria-label="Next week" disabled={!selected||weekNumber>=selected.week_count} onClick={()=>selectWeek(weekNumber+1)}><ChevronRight size={17}/></button>
  </div>;
  const weekEditButton=!isReadOnly&&selected&&<button className="btn secondary small" onClick={()=>{setWeekDraft({title:week?.title||'',objectives:week?.objectives||''});setDialog('week');}}><Pencil size={14}/>{week?'Edit week':'Set up week'}</button>;

  return <>
    <div className="page-heading planner-page-heading planner-study-heading">
      <div><span className="eyebrow"><GraduationCap size={13}/> STUDY WORKSPACE</span><h1>{semester?.name||'Your semesters'}</h1><p>{semester?`${activeCount} ${activeCount===1?'course':'courses'} · Choose a course to continue your week`:'Organize courses by semester, then continue your weekly study work.'}</p></div>
      <div className="planner-heading-actions">
        {activeSemester&&<button className="btn secondary" onClick={()=>editSemester(activeSemester)} disabled={busy}><Pencil size={15}/> Edit semester</button>}
        <button type="button" className="btn primary" onClick={()=>openCourseForm()} disabled={busy||!semesterOptions.length}><Plus size={16}/> Course</button>
      </div>
    </div>
    <div className="planner-shell planner-study-shell">
      <aside className="planner-rail planner-study-rail">
        <button type="button" className="planner-rail-title planner-rail-toggle" aria-expanded={semestersExpanded} aria-controls="planner-semester-section" onClick={()=>setSemestersExpanded(value=>!value)}><span>YOUR SEMESTERS</span><ChevronDown size={16} className={semestersExpanded?'':'collapsed'} aria-hidden="true"/></button>
        {semestersExpanded&&<div id="planner-semester-section" className="planner-rail-section">
          <div className="planner-semester-tree">{semesterOptions.map((s,index)=>{
            const expanded=openSemesterKeys.includes(s.key);
            const isCurrent=s.key===currentSemesterKey;
            const inSemester=data.courses.filter(c=>courseSemester(c,semesterOptions)===s.key);
            const activeCourses=inSemester.filter(c=>!c.archived);
            const listedCourses=isCurrent&&showArchived?inSemester.filter(c=>c.archived):activeCourses;
            return <div key={s.key} className={'planner-semester-group'+(isCurrent?' current':'')}>
              <button type="button" className={'planner-semester-row planner-semester-row-action'+(isCurrent?' selected':'')} aria-expanded={expanded} aria-controls={`planner-semester-children-${index}`} aria-current={isCurrent?'true':undefined} onClick={()=>onSemesterRowClick(s.key)}>
                <ChevronRight size={15} className={expanded?'expanded':''} aria-hidden="true"/>
                <span className="planner-semester-name">{s.name}</span>
                <span className="planner-semester-count" aria-label={`${activeCourses.length} active courses`}>{activeCourses.length}</span>
              </button>
              {expanded&&<div id={`planner-semester-children-${index}`} className="planner-semester-children">
                {listedCourses.map(c=><button type="button" className={'planner-semester-course'+(selectedId===c.id&&isCurrent?' selected':'')} key={c.id} onClick={()=>chooseCourse(c)}>
                  <strong className="planner-semester-code">{c.code}</strong><span className="planner-semester-course-name">{c.title}</span>
                </button>)}
                {!listedCourses.length&&<p className="planner-semester-no-courses">{isCurrent&&showArchived?'No archived courses.':'No active courses.'}</p>}
              </div>}
            </div>;
          })}</div>
          <button className={'planner-archive-toggle'+(showArchived?' selected':'')} onClick={()=>{
            const next=!showArchived;setShowArchived(next);
            const replacement=matching.find(c=>Boolean(c.archived)===next);
            selectCourse(replacement?.id||'');selectWeek(1);setWorkspaceTab('overview');
          }}><Archive size={15}/>{showArchived?'Back to active courses':`Archived courses (${archivedCount})`}</button>
          <div className="planner-study-add-semester"><button type="button" className="btn primary" disabled={busy} onClick={()=>editSemester()}><Plus size={17}/> Semester</button></div>
        </div>}
      </aside>
      <div className="planner-workspace">
        {!semester ? <div className="planner-empty-main"><GraduationCap size={34}/><h2>Start with a semester</h2><p>Create your first semester to organize your courses and weeks.</p><button className="btn primary" onClick={()=>editSemester()}><Plus size={16}/> Add semester</button></div>
        : !selected ? <div className="planner-empty-main"><BookOpen size={34}/><h2>{showArchived?'No archived courses':'No courses in '+semester.name}</h2><p>{showArchived?'Courses you archive will appear here.':'Create a course in this semester to begin your study plan.'}</p>{!showArchived&&<button className="btn primary" onClick={()=>openCourseForm()}><Plus size={16}/> Add course</button>}</div>
        : <>
          <div className="planner-course-header planner-study-course-header">
            <div><span className="eyebrow">{selected.code} · COURSE WORKSPACE</span><h2>{selected.title}</h2><p>{semester.name} · {selected.week_count} teaching weeks{selected.exam_date?` · Exam ${formatDate(selected.exam_date)}`:''}</p>{selected.goals&&<p className="planner-goal">{selected.goals}</p>}</div>
            <div className="planner-course-actions">
              {isReadOnly?<><Badge>Archived · read only</Badge><button className="btn primary small" onClick={()=>void restore(selected)}><RotateCcw size={14}/> Restore</button></>:<>
                <button className="btn secondary small" onClick={()=>openCourseForm(selected)}><Pencil size={15}/> Edit</button>
                <button className="btn secondary small" onClick={()=>setDialog('archive')} disabled={busy}><Archive size={15}/> Archive</button>
              </>}
            </div>
          </div>
          <div className="planner-hero planner-study-hero">
            <div><span>WEEK {weekNumber} · CONTINUE LEARNING</span><h3>{week?.title||`Continue with Week ${weekNumber}`}</h3>{week?.objectives&&<p>{week.objectives}</p>}</div>
            <div className="planner-hero-progress"><strong>{courseCompletion}%</strong><small>{courseDoneCount}/{courseItems.length} complete</small><div className="progress-track" role="progressbar" aria-valuenow={courseCompletion} aria-valuemin={0} aria-valuemax={100} aria-label="Course completion"><div style={{width:`${courseCompletion}%`}}/></div></div>
          </div>
          <div className="planner-week-toolbar planner-study-week-toolbar">{weekPicker}{weekEditButton}</div>
          <nav className="planner-tabbar planner-study-tabs" aria-label="Course workspace sections">{([
            ['overview','Overview',BookOpen],['course-library','Course library',Library],
            ['week-resources','Week resources',FolderOpen],['tasks','Study tasks',ListChecks],
            ['exam','Exam prep',GraduationCap]
          ] as const).map(([key,label,Icon])=><button key={key} className={workspaceTab===key?'active':''} aria-current={workspaceTab===key?'page':undefined} onClick={()=>setWorkspaceTab(key)}><Icon size={16}/>{label}</button>)}</nav>
          {workspaceTab==='overview'&&<div className="planner-main-grid planner-study-overview planner-classic-overview">
            <Card className="planner-study-week-card planner-learning-checklist">
              <div className="planner-classic-card-title"><h3>Weekly learning checklist</h3><div className="planner-classic-heading-actions">
                <button type="button" className="btn secondary small planner-filter-toggle" aria-expanded={filtersOpen} aria-controls="study-activity-filters" title="Filter weekly activities" onClick={()=>setFiltersOpen(value=>!value)}><ListFilter size={15}/>{activityFilter==='all'?'Filter':activityFilter[0].toUpperCase()+activityFilter.slice(1)}</button>
                {!isReadOnly&&<button className="btn secondary small" onClick={()=>{setItemDraft(itemDraftDefaults);setDialog('item');}}><Plus size={15}/> Add activity</button>}
              </div></div>
              {filtersOpen&&<div id="study-activity-filters" className="planner-study-filters" aria-label="Filter weekly activities">{(['all','planned','due','completed'] as const).map(filter=><button key={filter} type="button" className={activityFilter===filter?'active':''} aria-pressed={activityFilter===filter} onClick={()=>setActivityFilter(filter)}>{filter[0].toUpperCase()+filter.slice(1)}</button>)}</div>}
              {filteredItems.length?filteredItems.map(i=>{
                const overdue=isOverdue(i,today);
                return <div className={'planner-task-row planner-study-task task-completion-row'+(overdue?' overdue':'')+(landingItem?.id===i.id?' planner-target-item':'')+(completingIds.has(i.id)?' is-completing':'')+((activityFilter==='planned'||activityFilter==='due')&&exitingIds.has(i.id)?' is-exiting':'')} ref={landingItem?.id===i.id?landingRef:undefined} key={i.id}>
                  <input type="checkbox" disabled={isReadOnly||busy||pendingItems.has(i.id)||completingIds.has(i.id)} className="task-completion-check" checked={i.done||completingIds.has(i.id)} onChange={()=>toggleItem(i)} aria-label={`Complete ${i.title}`}/>
                  <div><strong className={i.done?'complete':''}>{i.title}</strong><small>{kindLabels[i.kind]}{i.planned_date?` · Planned ${formatDate(i.planned_date)}`:''}{i.due_date?` · Due ${formatDate(i.due_date)}`:''}{i.chapter?` · ${i.chapter}`:''}{i.page_start?` · pp. ${i.page_start}${i.page_end?`–${i.page_end}`:''}`:''}</small>
                    {i.resource_id&&<button className="planner-inline-link" onClick={()=>{const r=shared.find(r=>r.id===i.resource_id)||weekResources.find(r=>r.id===i.resource_id);if(r)openResource(r);}}>Open document <ExternalLink size={12}/></button>}
                  </div>
                  {overdue&&<span className="planner-study-status overdue">Overdue</span>}
                  {!overdue&&i.planned_date===today&&!i.done&&<span className="planner-study-status">Today</span>}
                  {!isReadOnly&&<button className="icon-btn" disabled={busy||i.done||pendingItems.has(i.id)||completingIds.has(i.id)} onClick={()=>openActivityPlan(i)} title={i.planned_date?`Reschedule ${i.title}`:`Plan ${i.title}`} aria-label={`Plan ${i.title}`}><CalendarDays size={16}/></button>}
                  {!isReadOnly&&<button className="icon-btn" disabled={busy} aria-label={`Focus on ${i.title}`} onClick={()=>focusOn(i)}><Timer size={16}/></button>}
                  {!isReadOnly&&<button className="icon-btn danger-hover" disabled={busy} aria-label={`Delete ${i.title}`} onClick={()=>void deleteItem(i)}><X size={15}/></button>}
                </div>;
              }):<EmptyState icon={<CheckCircle2 size={23}/>} title={items.length?'No activities in this filter':'A fresh week'} detail={items.length?'Choose All to see every weekly activity.':'Add a lecture, reading, note, or revision task to begin.'}/>}
            </Card>
            <div className="stack planner-study-side-cards">
              <Card className="planner-study-week-resources-card"><div className="planner-classic-card-title"><h3>Week resources</h3><button className="planner-inline-link" onClick={()=>setWorkspaceTab('week-resources')}>View all <ArrowRight size={15}/></button></div>
                {weekResources.slice(0,2).map(resourceRow)}
                {!weekResources.length&&<p className="planner-study-hint">No slides linked for this week yet.</p>}
                {!isReadOnly&&<button className="btn secondary full planner-resource-footer" onClick={()=>openResourceForm('week')}><Plus size={15}/> Link lecture slides</button>}
              </Card>
              <Card className="planner-study-shared-library-card"><div className="planner-classic-card-title"><h3>Shared course library</h3><Badge>{shared.length} {shared.length===1?'file':'files'}</Badge></div>
                {shared.slice(0,3).map(resourceRow)}
                {!shared.length&&<p className="planner-study-hint">No shared textbooks or Goodnotes notebooks linked yet.</p>}
                <button className="btn secondary full planner-resource-footer" onClick={()=>setWorkspaceTab('course-library')}><Library size={15}/> Open Course Library</button>
              </Card>
              <Card className="planner-study-notes-card"><SectionTitle title="Quick notes" aside={!isReadOnly&&<button className="planner-inline-link" onClick={startNote}><Plus size={15}/> Add note</button>}/>
                {weekNotes.length?weekNotes.slice(0,3).map(note=><div className="planner-study-note" key={note.id}><div><strong>{note.title}</strong><p>{note.notes||'No text added yet.'}</p></div>{!isReadOnly&&<button className="icon-btn" aria-label={`Edit note ${note.title}`} onClick={()=>editNote(note)}><Pencil size={15}/></button>}</div>):<p className="planner-study-note-empty">No notes yet. Add a note for Week {weekNumber}.</p>}
              </Card>
            </div>
          </div>}
          {workspaceTab==='course-library'&&<Card className="planner-library-panel"><SectionTitle title="Course Library" aside={!isReadOnly&&<button className="btn primary small" onClick={()=>openResourceForm('course')}><Plus size={14}/> Add shared resource</button>}/>
            {shared.length?shared.map(resourceRow):<EmptyState icon={<Library size={26}/>} title="Your shared library is empty" detail="Add a book, whole-course Goodnotes notebook, or reference PDF."/>}
            {!isReadOnly&&<button className="btn secondary full" onClick={()=>openDrive(selected.id,weekNumber,'textbook','course')}><Cloud size={16}/> Browse Goodnotes backups for this course</button>}
          </Card>}
          {workspaceTab==='week-resources'&&<Card><SectionTitle title={`Week ${weekNumber} resources`} aside={!isReadOnly&&<button className="btn primary small" onClick={()=>openResourceForm('week')}><Plus size={14}/> Add link</button>}/>
            {weekResources.length?weekResources.map(resourceRow):<EmptyState icon={<FileText size={24}/>} title="No weekly materials" detail="Link DTU Learn lecture slides or choose a backed-up annotated PDF."/>}
            {!isReadOnly&&<button className="btn secondary full" onClick={()=>openDrive(selected.id,weekNumber,'annotated','week')}><Cloud size={16}/> Browse Goodnotes backups</button>}
          </Card>}
          {workspaceTab==='tasks'&&<Card><SectionTitle title="Course study tasks" aside={!isReadOnly&&<button className="btn primary small" onClick={()=>{setItemDraft({...itemDraftDefaults,kind:'assignment',is_task:true});setDialog('item');}}><Plus size={14}/> Add task</button>}/>
            {courseItems.filter(i=>isActionable(i)).map(i=><div className={'planner-task-row task-completion-row'+(landingItem?.id===i.id?' planner-target-item':'')+(completingIds.has(i.id)?' is-completing':'')} ref={landingItem?.id===i.id?landingRef:undefined} key={i.id}><input type="checkbox" className="task-completion-check" disabled={isReadOnly||busy||pendingItems.has(i.id)||completingIds.has(i.id)} checked={i.done||completingIds.has(i.id)} onChange={()=>toggleItem(i)}/><div><strong className={i.done?'complete':''}>{i.title}</strong><small>{i.week_number?`Week ${i.week_number}`:'Exam prep'} · {kindLabels[i.kind]}{i.due_date?` · Due ${formatDate(i.due_date)}`:''}</small></div>{!isReadOnly&&<button className="icon-btn" onClick={()=>focusOn(i)} title="Start focus"><Timer size={16}/></button>}</div>)}
            {!courseItems.some(i=>isActionable(i))&&<EmptyState icon={<CalendarDays size={24}/>} title="No scheduled work" detail="Add assignments or schedule a revision activity."/>}
          </Card>}
          {workspaceTab==='exam'&&<Card><SectionTitle title="Exam preparation" aside={<Badge>{examItems.filter(i=>i.done).length}/{examItems.length} completed</Badge>}/>
            {!isReadOnly&&<form className="exam-task-form" onSubmit={e=>void saveExam(e)}><input aria-label="Exam preparation task" placeholder="Practise old exam papers" value={examTitle} onChange={e=>setExamTitle(e.target.value)} required/><button className="btn primary small" disabled={busy||!examTitle.trim()}>Add task</button></form>}
            {examItems.map(i=><div className={'planner-task-row task-completion-row'+(landingItem?.id===i.id?' planner-target-item':'')+(completingIds.has(i.id)?' is-completing':'')} ref={landingItem?.id===i.id?landingRef:undefined} key={i.id}><input type="checkbox" className="task-completion-check" disabled={isReadOnly||busy||pendingItems.has(i.id)||completingIds.has(i.id)} checked={i.done||completingIds.has(i.id)} onChange={()=>toggleItem(i)}/><div><strong className={i.done?'complete':''}>{i.title}</strong></div>{!isReadOnly&&<button className="icon-btn" onClick={()=>focusOn(i)} title="Start focus"><Timer size={16}/></button>}</div>)}
            {!examItems.length&&<EmptyState icon={<BookMarked size={23}/>} title="Exam preparation starts here" detail="Add past papers, mock exams and course-wide revision plans."/>}
          </Card>}
        </>}
      </div>
    </div>

    {dialog&&<div className="dialog-backdrop" role="presentation"><div className="dialog planner-dialog" role="dialog" aria-modal="true" aria-label={`${dialog} configuration`}>
      <button className="dialog-close" disabled={busy} onClick={()=>setDialog(null)} aria-label="Close dialog"><X size={18}/></button>
      {dialog==='semester'&&<><h2>{semDraft.id?'Edit semester':'New semester'}</h2><form onSubmit={e=>void saveSemester(e)}><FormRow label="Semester name"><input autoFocus required maxLength={60} placeholder="Autumn 2026" value={semDraft.name} onChange={e=>setSemDraft(p=>({...p,name:e.target.value}))}/></FormRow><div className="form-grid"><FormRow label="Starts (optional)"><input type="date" value={semDraft.start_date} onChange={e=>setSemDraft(p=>({...p,start_date:e.target.value}))}/></FormRow><FormRow label="Ends (optional)"><input type="date" value={semDraft.end_date} onChange={e=>setSemDraft(p=>({...p,end_date:e.target.value}))}/></FormRow></div><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin" aria-hidden="true"/> Saving…</>:'Save semester'}</button></div></form></>}
      {dialog==='course'&&<><h2>{editCourseId?'Edit course':'Add a course'}</h2><form onSubmit={e=>void saveCourse(e)}><div className="form-grid"><FormRow label="Course code"><input required maxLength={40} value={courseDraft.code} placeholder="02516" onChange={e=>setCourseDraft(p=>({...p,code:e.target.value}))}/></FormRow><FormRow label="Teaching weeks"><input required type="number" min={1} max={30} value={courseDraft.week_count} onChange={e=>setCourseDraft(p=>({...p,week_count:Number(e.target.value)}))}/></FormRow><FormRow label="Course title"><input required maxLength={180} value={courseDraft.title} onChange={e=>setCourseDraft(p=>({...p,title:e.target.value}))} placeholder="Image Analysis & Computer Vision"/></FormRow><FormRow label="Semester"><select required value={courseDraft.semester_key} onChange={e=>setCourseDraft(p=>({...p,semester_key:e.target.value}))}>{semesterOptions.map(s=><option key={s.key} value={s.key}>{s.name}</option>)}</select></FormRow><FormRow label="Exam date (optional)"><input type="date" value={courseDraft.exam_date} onChange={e=>setCourseDraft(p=>({...p,exam_date:e.target.value}))}/></FormRow><FormRow label="Study goals"><textarea rows={2} maxLength={2000} value={courseDraft.goals} onChange={e=>setCourseDraft(p=>({...p,goals:e.target.value}))}/></FormRow></div><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin" aria-hidden="true"/> Saving…</>:'Save course'}</button></div></form></>}
      {dialog==='archive'&&selected&&<><h2>Archive {selected.code}?</h2><p>It will disappear from your active planner. Unfinished tasks won't appear in Today. All notes, documents, week progress and focus history will be kept.</p><div className="planner-archive-preview"><span>{linkedCounts.items} study items</span><span>{linkedCounts.documents} resource links</span><span>{linkedCounts.sessions} focus sessions</span></div><div className="form-actions"><button className="btn secondary" onClick={()=>setDialog(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={()=>void archive()}><Archive size={15}/> Archive course</button></div></>}
      {dialog==='week'&&<><h2>Week {weekNumber} details</h2><form onSubmit={e=>void saveWeek(e)}><FormRow label="Topic"><input required value={weekDraft.title} placeholder="Multiclass segmentation" onChange={e=>setWeekDraft(p=>({...p,title:e.target.value}))}/></FormRow><FormRow label="Learning objectives"><textarea rows={3} value={weekDraft.objectives} onChange={e=>setWeekDraft(p=>({...p,objectives:e.target.value}))}/></FormRow><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button className="btn primary" disabled={busy} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin"/> Saving…</>:'Save week'}</button></div></form></>}
      {dialog==='plan-item'&&planItem&&<><h2>Plan study activity</h2><p><strong>{planItem.title}</strong> · Week {planItem.week_number}</p>
        <div className="form-actions planner-plan-quick"><button className="btn secondary" disabled={busy||Boolean(planItem.due_date&&localToday()>planItem.due_date)} title={planItem.due_date&&localToday()>planItem.due_date?`Deadline passed on ${formatDate(planItem.due_date)}; cannot schedule today`:undefined} onClick={()=>void updateActivityPlan(localToday())}><CalendarDays size={15}/> Plan for today</button></div>
        <form onSubmit={e=>{e.preventDefault();if(planDate)void updateActivityPlan(planDate);}}><FormRow label="Choose a planned date"><input type="date" required max={planItem.due_date||undefined} value={planDate} onChange={e=>setPlanDate(e.target.value)}/></FormRow><div className="form-actions">{planItem.planned_date&&<button type="button" className="btn secondary" disabled={busy} onClick={()=>void updateActivityPlan(null)}>Clear date</button>}<button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button className="btn primary" type="submit" disabled={busy||!planDate||Boolean(planItem.due_date&&planDate>planItem.due_date)}>{busy?<><LoaderCircle size={15} className="spin"/> Saving…</>:'Save plan'}</button></div></form>
        {planItem.due_date&&<p className="planner-plan-note">This activity must be planned no later than {formatDate(planItem.due_date)}.</p>}
        {planItem.planned_date&&<p className="planner-plan-note">Clearing the date keeps this activity in the Tasks inbox as unscheduled work.</p>}
      </>}
      {dialog==='item'&&<><h2>New study activity</h2><p>Reading and notes can reference the shared course book or notebook.</p><form onSubmit={e=>void saveItem(e)}><FormRow label="Title"><input required value={itemDraft.title} onChange={e=>setItemDraft(p=>({...p,title:e.target.value}))}/></FormRow><div className="form-grid"><FormRow label="Activity type"><select value={itemDraft.kind} onChange={e=>setItemDraft(p=>({...p,kind:e.target.value as Item['kind']}))}>{(['lecture','notes','reading','revision','assignment'] as const).map(kind=><option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></FormRow><FormRow label="Reference a shared book or notebook"><select value={itemDraft.resource_id} onChange={e=>setItemDraft(p=>({...p,resource_id:e.target.value}))}><option value="">No linked document</option>{shared.map(r=><option value={r.id} key={r.id}>{r.title}</option>)}</select></FormRow><FormRow label="Chapter / section"><input value={itemDraft.chapter} onChange={e=>setItemDraft(p=>({...p,chapter:e.target.value}))}/></FormRow><FormRow label="Pages from"><input type="number" min={1} value={itemDraft.page_start} onChange={e=>setItemDraft(p=>({...p,page_start:e.target.value}))}/></FormRow><FormRow label="Pages to"><input type="number" min={1} value={itemDraft.page_end} onChange={e=>setItemDraft(p=>({...p,page_end:e.target.value}))}/></FormRow><FormRow label="Planned date"><input type="date" max={itemDraft.due_date||undefined} value={itemDraft.planned_date} onChange={e=>setItemDraft(p=>({...p,planned_date:e.target.value}))}/></FormRow><FormRow label="Due date"><input type="date" min={itemDraft.planned_date||undefined} value={itemDraft.due_date} onChange={e=>setItemDraft(p=>({...p,due_date:e.target.value}))}/></FormRow></div><FormRow label="Notes (optional)"><textarea rows={3} maxLength={5000} placeholder="Quick notes, lecture takeaways or reference details" value={itemDraft.notes} onChange={e=>setItemDraft(p=>({...p,notes:e.target.value}))}/></FormRow><label className="inline-check"><input type="checkbox" checked={itemDraft.kind==='assignment'||itemDraft.is_task} disabled={itemDraft.kind==='assignment'} onChange={e=>setItemDraft(p=>({...p,is_task:e.target.checked}))}/> Include in Tasks</label><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button className="btn primary" disabled={busy||!itemDraft.title.trim()||Boolean(itemDraft.planned_date&&itemDraft.due_date&&itemDraft.planned_date>itemDraft.due_date)} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin"/> Saving…</>:'Add activity'}</button></div></form></>}
      {dialog==='edit-note'&&<><h2>Edit quick note</h2><p>Saved to the current course's teaching week and available across devices.</p><form onSubmit={e=>void saveNote(e)}><FormRow label="Title"><input required autoFocus maxLength={240} value={noteDraft.title} onChange={e=>setNoteDraft(p=>({...p,title:e.target.value}))}/></FormRow><FormRow label="Note"><textarea rows={5} maxLength={5000} value={noteDraft.notes} onChange={e=>setNoteDraft(p=>({...p,notes:e.target.value}))}/></FormRow><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button type="submit" className="btn primary" disabled={busy||!noteDraft.title.trim()} aria-busy={busy}>{busy?'Saving…':'Save note'}</button></div></form></>}
      {dialog==='resource'&&<><h2>{resourceEditId?'Edit resource':'Link a resource'}</h2><p>Keep whole-course books and notebooks shared; use weekly links for lecture slides.</p><form onSubmit={e=>void saveResource(e)}><FormRow label="Resource title"><input required value={resourceDraft.title} onChange={e=>setResourceDraft(p=>({...p,title:e.target.value}))}/></FormRow><FormRow label="Available in"><select value={resourceScope} onChange={e=>setResourceScope(e.target.value as 'course'|'week')}><option value="course">Course Library — all weeks</option><option value="week">Only Week {weekNumber}</option></select></FormRow>{!editingResource&&<FormRow label="Document URL (HTTPS)"><input type="url" required value={resourceDraft.url} placeholder="https://..." onChange={e=>setResourceDraft(p=>({...p,url:e.target.value}))}/></FormRow>}<div className="form-grid"><FormRow label="Document type"><select value={resourceDraft.kind} onChange={e=>setResourceDraft(p=>({...p,kind:e.target.value as ResourceKind}))}>{(['textbook','handwritten','slides','annotated','other'] as const).map(k=><option key={k} value={k}>{k}</option>)}</select></FormRow>{!editingResource&&<FormRow label="Source"><select value={resourceDraft.source} onChange={e=>setResourceDraft(p=>({...p,source:e.target.value as 'dtu'|'link'}))}><option value="dtu">DTU Learn</option><option value="link">Other link</option></select></FormRow>}{resourceScope==='week'&&<FormRow label="Attach to study activity"><select value={resourceDraft.item_id} onChange={e=>setResourceDraft(p=>({...p,item_id:e.target.value}))}><option value="">Whole week</option>{items.map(i=><option value={i.id} key={i.id}>{i.title}</option>)}</select></FormRow>}<FormRow label="Chapter"><input value={resourceDraft.chapter} onChange={e=>setResourceDraft(p=>({...p,chapter:e.target.value}))}/></FormRow><FormRow label="Page start"><input type="number" min={1} value={resourceDraft.page_start} onChange={e=>setResourceDraft(p=>({...p,page_start:e.target.value}))}/></FormRow><FormRow label="Page end"><input type="number" min={1} value={resourceDraft.page_end} onChange={e=>setResourceDraft(p=>({...p,page_end:e.target.value}))}/></FormRow></div><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin" aria-hidden="true"/> Saving…</>:'Save link'}</button></div></form></>}
      {busy&&<p className="planner-save-status" role="status" aria-live="polite"><LoaderCircle size={14} className="spin" aria-hidden="true"/> Saving changes to Study Hub…</p>}
    </div></div>}
  </>;
}
