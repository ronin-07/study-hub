'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  Archive, ArrowRight, BookMarked, BookOpen, CalendarDays, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, Cloud, ExternalLink, FileText, FolderOpen, GraduationCap,
  Library, ListChecks, ListFilter, LoaderCircle, NotebookPen, Pencil, Plus, RotateCcw, Timer, Trash2, Unlink, X
} from 'lucide-react';
import { api } from '@/lib/api';
import {activityResources,availableExamPapers,isExamResource} from '@/lib/resource-links';
import { ResourceRemovalDialog } from '@/components/resource-removal-dialog';
import { CourseDeletionDialog } from '@/components/course-deletion-dialog';
import { ExamHero, ExamPapers } from '@/components/exam-prep';
import { checklistPercent } from '@/lib/progress-presentation';
import type { FocusMode } from '@/lib/types';
import { categoryInTitle, examFocusThisWeek } from '@/lib/exam-prep';
import { ActivityGenerator } from '@/components/activity-generator';
import type { ActivityDefinition, GenerationResult } from '@/lib/activity-generator';
import type { MutationHint } from '@/lib/snapshot-cache';
import { Badge, Card, EmptyState, FormRow, SectionTitle } from '@/components/common';
import { ProgressTrack, ProgressValue } from '@/components/progress-motion';
import { TaskActionsMenu } from '@/components/task-actions-menu';
import { PhotoEmptyState } from '@/components/photo-empty-state';
import type { FeedbackMessage } from '@/components/feedback-toasts';
import { isActionable } from '@/lib/task-view';
import { courseLearningItems, examPreparationItems } from '@/lib/study-progress';
import { activityKindFallback, activityReference, activityStatus, activityStatusLabel, shortStudyDate } from '@/lib/activity-display';
import { resolveWorkspaceSemester } from '@/lib/course-navigation';
import { type Course, type Item, type Resource, type Semester, type Snapshot, formatDate, kindLabels, localToday } from '@/lib/types';

type SemesterOption = { key: string; name: string; id: string | null; registered: boolean };
type WorkspaceTab = 'overview' | 'course-library' | 'week-resources' | 'tasks' | 'exam';
type ResourceKind = Resource['kind'];
type Dialog = 'semester' | 'course' | 'archive' | 'resource' | 'item' | 'plan-item' | 'week' | null;
type CourseDraft = { code: string; title: string; semester_key: string; week_count: number; exam_date: string; exam_time:string; exam_duration_minutes:string; exam_location:string; exam_format:string; goals: string };
type ResourceDraft = { title: string; kind: ResourceKind; source: 'link' | 'dtu'; url: string; chapter: string; page_start: string; page_end: string; item_id: string; exam_paper_id: string };
type ItemDraft = { title: string; notes: string; kind: Item['kind']; is_task: boolean; hidden_from_tasks: boolean; planned_date: string; due_date: string; chapter: string; page_start: string; page_end: string; resource_id: string };

const courseDraftDefaults: CourseDraft = { code: '', title: '', semester_key: '', week_count: 13, exam_date: '', exam_time:'', exam_duration_minutes:'', exam_location:'', exam_format:'', goals: '' };
const resourceDraftDefaults: ResourceDraft = { title: '', kind: 'slides', source: 'dtu', url: '', chapter: '', page_start: '', page_end: '', item_id: '', exam_paper_id: '' };
const itemDraftDefaults: ItemDraft = { title: '', notes: '', kind: 'lecture', is_task: false, hidden_from_tasks: false, planned_date: '', due_date: '', chapter: '', page_start: '', page_end: '', resource_id: '' };

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
  progressItems: Item[];
  user: User | null;
  busy: boolean;
  pendingItems: ReadonlySet<string>;
  completingIds: ReadonlySet<string>;
  exitingIds: ReadonlySet<string>;
  courseId: string;
  weekNumber: number;
  landingItem?: { id: string; weekNumber: number | null } | null;
  sectionJump?: {courseId:string;section:'course-library'|'tasks'|'exam';token:number}|null;
  selectCourse: (id: string) => void;
  selectWeek: (week: number) => void;
  run: (operation: () => Promise<unknown>, mutation?: MutationHint, feedback?: FeedbackMessage) => Promise<boolean>;
  toggleItem: (item: Item) => void;
  focusOn: (item: Item) => void;
  preparePractice: (paper: Resource, mode: FocusMode) => Promise<boolean>;
  activeFocus: boolean;
  focusBusy: boolean;
  openFocus: () => void;
  openResource: (resource: Resource) => void;
  openDrive: (courseId: string, weekNumber: number, kind: ResourceKind, scope: 'course' | 'week', paperId?:string) => void;
}

/** Study and Global Tasks share one accessible, viewport-aware action menu. */
function CourseTaskActionMenu(props: {
  item:Item;busy:boolean;onEdit:()=>void;onPlan:()=>void;onRemove?:()=>void;onDelete:()=>void;
}) { return <TaskActionsMenu {...props}/>; }

/** Single registered semester -> course -> week navigation source of truth. */
export function CoursePlanner({ data, progressItems, user, busy, pendingItems, completingIds, exitingIds, courseId, weekNumber, selectCourse, selectWeek, run, toggleItem, focusOn, preparePractice, activeFocus, focusBusy, openFocus, openResource, openDrive, landingItem, sectionJump }: Props) {
  const semesterOptions = useMemo(() => makeSemesters(data), [data]);
  const [semesterKey, setSemesterKey] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [semestersExpanded, setSemestersExpanded] = useState(true);
  const [openSemesterKeys, setOpenSemesterKeys] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState<'all'|'planned'|'due'|'completed'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [semesterTreeReady, setSemesterTreeReady] = useState(false);
  const lastCourseNavigationRef = useRef(courseId);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(()=>landingItem && landingItem.weekNumber===null?'tasks':'overview');
  const landingRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{landingRef.current?.scrollIntoView({behavior:'smooth',block:'center'});},[landingItem?.id,workspaceTab]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deletionCourse,setDeletionCourse]=useState<Course|null>(null);
  const [removalResource,setRemovalResource]=useState<Resource|null>(null);
  const [generator,setGenerator]=useState<{course:Course;offerSetup:boolean}|null>(null);
  const [editCourseId, setEditCourseId] = useState('');
  const [courseDraft, setCourseDraft] = useState<CourseDraft>(courseDraftDefaults);
  const [semDraft, setSemDraft] = useState({ id: '', name: '', start_date: '', end_date: '' });
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft>(resourceDraftDefaults);
  const [resourceScope, setResourceScope] = useState<'course' | 'week'>('course');
  const [resourceEditId, setResourceEditId] = useState('');
  const [itemDraft, setItemDraft] = useState<ItemDraft>(itemDraftDefaults);
  const [editActivityId, setEditActivityId] = useState('');
  const [editingExamPrep, setEditingExamPrep] = useState(false);
  const [planItemId, setPlanItemId] = useState('');
  const [planDate, setPlanDate] = useState('');
  const [weekDraft, setWeekDraft] = useState({ title: '', objectives: '' });
  const [examTitle, setExamTitle] = useState('');
  const [examEntryOpen, setExamEntryOpen] = useState(false);
  const [courseTaskFilter, setCourseTaskFilter] = useState<'all'|'week'|'exam'>('all');
  const [initialCourseDraft, setInitialCourseDraft] = useState<CourseDraft>(courseDraftDefaults);
  const [initialSemesterDraft, setInitialSemesterDraft] = useState({ id: '', name: '', start_date: '', end_date: '' });

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
  useEffect(()=>{if(sectionJump?.courseId===selectedId)setWorkspaceTab(sectionJump.section);},[sectionJump?.token,selectedId]);
  const activeCount = matching.filter(c => !c.archived).length;
  const archivedCount = matching.filter(c => c.archived).length;
  const week = data.weeks.find(w => w.course_id === selectedId && w.number === weekNumber);
  const items = data.items.filter(i => i.course_id === selectedId && i.week_number === weekNumber);
  const examResources=data.resources.filter(r=>r.course_id===selectedId&&isExamResource(r.kind));
  const allShared = data.resources.filter(r => r.course_id === selectedId && (r.week_number === null || r.week_number === undefined));
  const shared=allShared.filter(r=>!isExamResource(r.kind));
  const weekResources = data.resources.filter(r => r.course_id === selectedId && r.week_number === weekNumber && !isExamResource(r.kind));
  // Overview previews are navigational, not a second resource editor. Keep one
  // underlying resource per file and prioritize reusable references by type.
  const libraryKinds: ResourceKind[] = ['textbook', 'handwritten', 'annotated', 'exam_paper', 'exam_solution', 'slides', 'other'];
  const sharedPreview = [...shared].sort((a,b) => libraryKinds.indexOf(a.kind) - libraryKinds.indexOf(b.kind)).slice(0,3);
  const courseItems = data.items.filter(i => i.course_id === selectedId);
  const examItems = examPreparationItems(courseItems,selectedId);
  const examProgressItems = examPreparationItems(progressItems,selectedId);
  const examDoneCount = examProgressItems.filter(i => i.done).length;
  const examFocusSeconds=examFocusThisWeek(data.sessions,examProgressItems,selectedId);
  const actionableCourseItems = courseItems.filter(isActionable);
  const filteredCourseTasks = actionableCourseItems.filter(i=>courseTaskFilter==='all'||(courseTaskFilter==='week'?i.week_number===weekNumber:i.week_number===null));
  // UI1 holds a completed row visibly for 900ms; progress must use the canonical
  // optimistic state rather than that presentation-only checklist projection.
  // Course learning progress is restricted to week-linked checklist activities.
  // Course-wide Exam Prep has its own count and must not inflate this metric.
  const progressCourseItems=courseLearningItems(progressItems,selectedId);
  const courseDoneCount=progressCourseItems.filter(i=>i.done).length;
  const courseCompletion=checklistPercent(courseDoneCount,progressCourseItems.length);
  const progressWeekItems=progressCourseItems.filter(i=>i.week_number===weekNumber);
  const weekDoneCount=progressWeekItems.filter(i=>i.done).length;
  const weekCompletion=checklistPercent(weekDoneCount,progressWeekItems.length);
  const today=localToday();
  const filteredItems=items.filter(i=>activityFilter==='all'||(activityFilter==='completed'?i.done:!i.done&&(activityFilter==='planned'?Boolean(i.planned_date):Boolean(i.due_date))));
  const isReadOnly = Boolean(selected?.archived);
  // Never carry a previous course or week's activity filter into a new workspace.
  useEffect(()=>{setActivityFilter('all');setFiltersOpen(false);},[selectedId,weekNumber]);
  useEffect(()=>{setCourseTaskFilter('all');setExamEntryOpen(false);},[selectedId]);

  useEffect(() => {
    if (selected && weekNumber > selected.week_count) selectWeek(selected.week_count);
  }, [selected?.id, selected?.week_count, weekNumber, selectWeek]);

  const chooseSemester = (key: string) => {
    setSemesterKey(key); setShowArchived(false); setWorkspaceTab('overview');
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
    selectCourse(course.id); setWorkspaceTab('overview');
  };
  const openCourseForm = (course?: Course) => {
    setEditCourseId(course?.id || '');
    const nextDraft = course ? {
      code: course.code, title: course.title, semester_key: courseSemester(course, semesterOptions),
      week_count: course.week_count, exam_date: course.exam_date || '', exam_time:course.exam_time?.slice(0,5)||'', exam_duration_minutes:String(course.exam_duration_minutes||''), exam_location:course.exam_location||'', exam_format:course.exam_format||'', goals: course.goals || ''
    } : { ...courseDraftDefaults, semester_key: currentSemesterKey };
    setCourseDraft(nextDraft);
    setInitialCourseDraft(nextDraft);
    setDialog('course');
  };
  const editSemester = (s?: Semester) => {
    const nextDraft = { id: s?.id || '', name: s?.name || '', start_date: s?.start_date || '', end_date: s?.end_date || '' };
    setSemDraft(nextDraft);
    setInitialSemesterDraft(nextDraft);
    setDialog('semester');
  };
  const closeDialog = () => {
    const changed = dialog==='semester'
      ? JSON.stringify(semDraft)!==JSON.stringify(initialSemesterDraft)
      : dialog==='course' && JSON.stringify(courseDraft)!==JSON.stringify(initialCourseDraft);
    if(changed && !window.confirm('Discard your unsaved changes?'))return;
    setDialog(null);
  };
  const saveSemester = async (e: FormEvent) => {
    e.preventDefault();
    const payload = { name: semDraft.name, start_date: semDraft.start_date || null, end_date: semDraft.end_date || null };
    let saved: Semester | null = null;
    const ok = await run(async () => {
      saved = await api<Semester>(semDraft.id ? `/api/semesters/${semDraft.id}` : '/api/semesters', user,
        { method: semDraft.id ? 'PATCH' : 'POST', body: payload });
    }, undefined, {title:semDraft.id?'Semester updated':'Semester created',detail:semDraft.name.trim()});
    if (ok) { if (saved) setSemesterKey(`id:${(saved as Semester).id}`); setDialog(null); }
  };
  const saveCourse = async (e: FormEvent) => {
    e.preventDefault();
    const target = semesterOptions.find(s => s.key === courseDraft.semester_key);
    if (!target) return;
    let saved: Course | null = null;
    const payload = { code: courseDraft.code.trim(), title: courseDraft.title.trim(),
      semester_id: target.id, semester: target.name, week_count: courseDraft.week_count,
      exam_date: courseDraft.exam_date || null, exam_time:courseDraft.exam_time||null, exam_duration_minutes:numberOrNull(courseDraft.exam_duration_minutes), exam_location:courseDraft.exam_location.trim(), exam_format:courseDraft.exam_format.trim(), goals: courseDraft.goals };
    const ok = await run(async () => {
      saved = await api<Course>(editCourseId ? `/api/courses/${editCourseId}` : '/api/courses', user,
        { method: editCourseId ? 'PATCH' : 'POST', body: payload });
      return saved;
    },{collection:'courses'}, {title:editCourseId?'Course updated':'Course created',detail:`${payload.code} · ${payload.title}`});
    if (ok) { setDialog(null); setSemesterKey(target.key); setShowArchived(false); if (saved) {const course=saved as Course;selectCourse(course.id);if(!editCourseId)setGenerator({course,offerSetup:true});} }
  };
  const generate = async (course:Course, activities:ActivityDefinition[], weeks:number[]) => {
    const feedback:FeedbackMessage={title:'Weekly activities generated'};
    return run(async()=>{
      const result=await api<GenerationResult>(`/api/courses/${course.id}/generate-activities`,user,{method:'POST',body:{activities,weeks}});
      feedback.detail=`${result.created} created · ${result.skipped} existing activities skipped`;
      return result;
    },{collection:'items',bulkInsert:true},feedback);
  };
  const archive = async () => {
    if (!selected) return;
    const archivedId=selected.id;
    const ok = await run(() => api(`/api/courses/${archivedId}/archive`, user, { method:'POST' }),{collection:'courses'},
      {title:'Course archived',detail:`${selected.code} is in Archived courses.`,
        action:{label:'Undo',onClick:()=>run(()=>api(`/api/courses/${archivedId}/restore`,user,{method:'POST'}),
          {collection:'courses'},{title:'Course restored',detail:'Your course is active again.'}).then(()=>{})}});
    if (ok) { setDialog(null); setShowArchived(false); selectCourse(matching.find(c => c.id !== selected.id && !c.archived)?.id || ''); }
  };
  const restore = async (course: Course) => {
    const ok = await run(() => api(`/api/courses/${course.id}/restore`, user, { method:'POST' }),{collection:'courses'},
      {title:'Course restored',detail:`${course.code} is active again.`});
    if (ok) { setShowArchived(false); selectCourse(course.id); setWorkspaceTab('overview'); }
  };
  const saveWeek = async (e: FormEvent) => {
    e.preventDefault(); if (!selected) return;
    const ok = await run(() => api(week ? `/api/weeks/${week.id}` : '/api/weeks', user, {
      method: week ? 'PATCH' : 'POST', body: week ? weekDraft : { ...weekDraft, course_id:selected.id, number:weekNumber }
    }),{collection:'weeks'},{title:'Week saved',detail:`Week ${weekNumber} updated.`});
    if (ok) setDialog(null);
  };
  const openActivityForm = (item?: Item) => {
    setEditActivityId(item?.id || '');
    // Course-wide legacy Revision items are the existing Exam Prep category.
    // Weekly Revision remains a distinct activity type; no stored data changes.
    setEditingExamPrep(Boolean(item && item.week_number === null && item.kind === 'revision'));
    setItemDraft(item ? {
      title: item.title, notes: item.notes || '', kind: item.kind, is_task: item.is_task,
      hidden_from_tasks: Boolean(item.hidden_from_tasks),
      planned_date: item.planned_date || '', due_date: item.due_date || '',
      chapter: item.chapter || '', page_start: String(item.page_start || ''),
      page_end: String(item.page_end || ''), resource_id: item.resource_id || ''
    } : itemDraftDefaults);
    setDialog('item');
  };
  const saveItem = async (e: FormEvent) => {
    e.preventDefault(); if (!selected) return;
    if(itemDraft.planned_date&&itemDraft.due_date&&itemDraft.planned_date>itemDraft.due_date)return;
    const payload = { ...itemDraft, course_id: selected.id, week_number:weekNumber,
      is_task: itemDraft.kind === 'assignment' || itemDraft.is_task || !!itemDraft.planned_date || !!itemDraft.due_date,
      planned_date:itemDraft.planned_date || null, due_date:itemDraft.due_date || null,
      resource_id:itemDraft.resource_id || null, page_start:numberOrNull(itemDraft.page_start), page_end:numberOrNull(itemDraft.page_end) };
    const { course_id: _courseId, week_number: _weekNumber, ...editable } = payload;
    const ok=await run(() => api(editActivityId ? `/api/items/${editActivityId}` : '/api/items', user,
      { method:editActivityId ? 'PATCH' : 'POST', body: editActivityId ? editable : payload }),{collection:'items'},
      {title:editActivityId?'Activity updated':'Activity added',detail:itemDraft.title.trim()});
    if (ok) { setDialog(null); setEditActivityId(''); setItemDraft(itemDraftDefaults); }
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
    }),{collection:'items'},{title:'Study plan saved',detail:date?`Planned for ${formatDate(date)}.`:'Planned date cleared.'});
    if (ok) setDialog(null);
  };
  const saveExam = async (e: FormEvent) => {
    e.preventDefault(); if (!selected || !examTitle.trim()) return;
    const ok = await run(() => api('/api/items',user,{method:'POST',body:{course_id:selected.id,week_number:null,
      kind:'revision',is_task:true,title:examTitle.trim()}}),{collection:'items'},
      {title:'Exam task added',detail:examTitle.trim()});
    if (ok) {setExamTitle('');setExamEntryOpen(false);}
  };
  const openResourceForm = (scope: 'course' | 'week', resource?: Resource, suggestedKind?: ResourceKind) => {
    setResourceScope(scope); setResourceEditId(resource?.id || '');
    setResourceDraft(resource ? {title:resource.title,kind:resource.kind,source:resource.source==='dtu'?'dtu':'link',
      url:resource.url || '',chapter:resource.chapter||'',page_start:String(resource.page_start||''),
      page_end:String(resource.page_end||''),item_id:resource.item_id||'',exam_paper_id:resource.exam_paper_id||''} : { ...resourceDraftDefaults,
        kind:suggestedKind || (scope==='course'?'textbook':'slides') });
    setDialog('resource');
  };
  const saveResource = async (e:FormEvent) => {
    e.preventDefault(); if (!selected || unavailableEditPaper) return;
    const existing = data.resources.find(r=>r.id===resourceEditId);
    const preserveLegacyExam=existing&&existing.week_number!=null&&resourceScope==='week'&&isExamResource(resourceDraft.kind);
    const existingWeek=existing?.week_number??weekNumber;
    const base = {title:resourceDraft.title,kind:resourceDraft.kind,chapter:resourceDraft.chapter,
      page_start:numberOrNull(resourceDraft.page_start),page_end:numberOrNull(resourceDraft.page_end),
      week_number:preserveLegacyExam?existing.week_number:isExamResource(resourceDraft.kind)||resourceScope==='course'?null:existingWeek,item_id:preserveLegacyExam?existing.item_id:isExamResource(resourceDraft.kind)||resourceScope==='course'?null:(resourceDraft.item_id||null),exam_paper_id:resourceDraft.kind==='exam_solution'?(resourceDraft.exam_paper_id||null):null};
    const payload = existing ? base : {...base,course_id:selected.id,source:resourceDraft.source,url:resourceDraft.url};
    const ok = await run(() => api(resourceEditId?`/api/resources/${resourceEditId}`:'/api/resources',user,
      {method:resourceEditId?'PATCH':'POST',body:payload}),{collection:'resources'},
      {title:resourceEditId?'Resource updated':'Resource linked',detail:resourceDraft.title.trim()});
    if (ok) {setDialog(null);setResourceEditId('');}
  };
  const detachResource=async(r:Resource,i:Item)=>{if(busy||pendingItems.size||!confirm(`Unlink “${r.title}” from “${i.title}”? The document will remain in your resources.`))return;await run(()=>api(`/api/resources/${r.id}/detach`,user,{method:'POST',body:{item_id:i.id}}),{collection:'resources',detachLinks:true},{title:'Document detached'});};
  const removeResource = (r:Resource) => {if(!busy&&!pendingItems.size)setRemovalResource(r);};
  const removeFromTasks = async (i:Item) => {
    if (i.week_number == null || busy || !confirm(`Remove “${i.title}” from Tasks and Calendar? The Week ${i.week_number} checklist activity will stay.`)) return;
    await run(() => api(`/api/items/${i.id}`,user,{method:'PATCH',body:{hidden_from_tasks:true}}),
      {collection:'items'},{title:'Removed from Tasks',detail:'The weekly learning activity was kept.'});
  };
  const deleteItem = async (i:Item) => {
    if (!confirm(`Remove study activity “${i.title}”? Linked resources must be detached first.`)) return;
    await run(() => api(`/api/items/${i.id}`,user,{method:'DELETE'}),{collection:'items',deleteId:i.id},
      {title:'Activity removed',detail:i.title});
  };
  const sourceLabel=(r:Resource)=>r.source==='drive'?'Goodnotes / Google Drive':r.source==='dtu'?'DTU Learn':'Web link';
  const resourceKindLabel=(kind:ResourceKind)=>kind==='exam_paper'?'Previous exam paper':kind==='exam_solution'?'Exam solution':kind==='textbook'?'Textbook':kind==='handwritten'?'Handwritten notes':kind==='annotated'?'Annotated slides':kind==='slides'?'Slides':'Other';
  const resourcePreviewRow = (r:Resource) => <button type="button" className="planner-resource-preview-row" key={r.id} onClick={()=>openResource(r)} title={`Open ${r.title}`}>
    <span className="planner-resource-preview-icon">{r.kind==='textbook'?<BookOpen size={18}/>:r.kind==='handwritten'?<NotebookPen size={18}/>:<FileText size={18}/>}</span>
    <span className="planner-resource-preview-copy"><strong>{r.title}</strong><small>{r.kind==='other'?sourceLabel(r):`${resourceKindLabel(r.kind)} · ${sourceLabel(r)}`}</small></span>
    {r.source==='drive'?<BookOpen size={15} className="planner-resource-preview-open" aria-hidden="true"/>:<ExternalLink size={14} className="planner-resource-preview-open" aria-hidden="true"/>}
  </button>;
  const resourceRow = (r:Resource) => <div className="planner-file-row" key={r.id}>
    <div className="planner-file-symbol">{r.kind==='textbook'?<BookOpen size={19}/>:r.kind==='handwritten'?<NotebookPen size={19}/>:<FileText size={19}/>}</div>
    <div className="planner-file-details"><strong>{r.title}</strong><small>{sourceLabel(r)} · {resourceKindLabel(r.kind)}{r.chapter?` · ${r.chapter}`:''}</small></div>
    <button type="button" className="icon-btn" title="Open resource" onClick={()=>openResource(r)}>{r.source==='drive'?<BookOpen size={17}/>:<ExternalLink size={17}/>}</button>
    {!isReadOnly&&<button type="button" className="icon-btn" title="Edit resource or move to Course Library" onClick={()=>openResourceForm(r.week_number==null?'course':'week',r)}><Pencil size={15}/></button>}
    {!isReadOnly&&<button type="button" className="icon-btn danger-hover" title="Remove resource" disabled={busy||pendingItems.size>0} onClick={()=>void removeResource(r)}><X size={15}/></button>}
  </div>;

  const renderCourseTask = (i: Item) => {
    const reference = activityReference(i);
    const context = i.week_number!==null ? `Week ${i.week_number}` : 'Exam prep';
    return <div className={'planner-task-row planner-course-task-row task-completion-row'+(i.done?' is-done':'')+(landingItem?.id===i.id?' planner-target-item':'')+(completingIds.has(i.id)?' is-completing':'')} ref={landingItem?.id===i.id?landingRef:undefined} key={i.id}>
      <input type="checkbox" className="task-completion-check" aria-label={`Complete ${i.title}`} disabled={isReadOnly||busy||pendingItems.has(i.id)||completingIds.has(i.id)} checked={i.done||completingIds.has(i.id)} onChange={()=>toggleItem(i)}/>
      <div className="planner-course-task-info"><strong className={i.done?'complete':''}>{i.title}</strong>
        {reference&&<span className="planner-course-task-reference">{reference}</span>}
        <small>{context}{i.planned_date?` · Planned ${shortStudyDate(i.planned_date)}`:''}{i.due_date?` · Due ${shortStudyDate(i.due_date)}`:''}</small>
      </div>
      {!isReadOnly&&<div className="planner-course-task-actions">
        <button type="button" className="icon-btn" disabled={busy} onClick={()=>focusOn(i)} aria-label={`Start focus for ${i.title}`} title="Start focus"><Timer size={16}/></button>
        <CourseTaskActionMenu item={i} busy={busy}
          onEdit={()=>openActivityForm(i)} onPlan={()=>openActivityPlan(i)}
          onRemove={i.week_number!==null?()=>void removeFromTasks(i):undefined}
          onDelete={()=>void deleteItem(i)}/>
      </div>}
    </div>;
  };

  const activeSemester = (data.semesters||[]).find(s=>s.id===semester?.id);
  const editingResource = data.resources.find(r=>r.id===resourceEditId);
  const editPaperOptions = dialog==='resource'&&resourceDraft.kind==='exam_solution'
    ? availableExamPapers(data.resources,selectedId,editingResource?.exam_paper_id) : [];
  const unavailableEditPaper = resourceDraft.kind==='exam_solution'&&Boolean(resourceDraft.exam_paper_id)
    && !editPaperOptions.some(p=>p.id===resourceDraft.exam_paper_id);
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
      <div><span className="eyebrow"><GraduationCap size={13}/> STUDY WORKSPACE</span><h1>{semester?.name||'Your semesters'}</h1><p>{semester?`${activeCount} ${activeCount===1?'course':'courses'} in this semester`:'Organize courses by semester, then continue your weekly study work.'}</p></div>
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
            selectCourse(replacement?.id||'');setWorkspaceTab('overview');
          }}><Archive size={15}/>{showArchived?'Back to active courses':`Archived courses (${archivedCount})`}</button>
          <div className="planner-study-add-semester"><button type="button" className="btn primary" disabled={busy} onClick={()=>editSemester()}><Plus size={17}/> Semester</button></div>
        </div>}
      </aside>
      <div className="planner-workspace">
        {!semester ? <div className="planner-empty-main"><PhotoEmptyState scene="study" title="Start with a semester" detail="Create a semester to organize courses and study materials." actionLabel="Add semester" onAction={()=>editSemester()}/></div>
        : !selected ? showArchived?<div className="planner-empty-main"><BookOpen size={34}/><h2>No archived courses</h2><p>Courses you archive will appear here.</p></div>:<div className="planner-empty-main"><PhotoEmptyState scene="study" title="Add your semester courses" detail="Add a course to organize your weekly studies and resources." actionLabel="Add course" onAction={()=>openCourseForm()}/></div>
        : <>
          <div className="planner-course-header planner-study-course-header">
            <div><span className="eyebrow">{selected.code} · COURSE WORKSPACE</span><h2>{selected.title}</h2><p>{semester.name} · {selected.week_count} teaching weeks{selected.exam_date?` · Exam ${formatDate(selected.exam_date)}`:''}</p>{selected.goals&&<p className="planner-goal">{selected.goals}</p>}</div>
            <div className="planner-course-actions">
              {isReadOnly?<><Badge>Archived · read only</Badge><button className="btn primary small" disabled={busy} onClick={()=>void restore(selected)}><RotateCcw size={14}/> Restore</button><button className="btn secondary small planner-delete-course-trigger" disabled={busy} onClick={()=>setDeletionCourse(selected)}><Trash2 size={15}/> Delete permanently</button></>:<>
                <button className="btn primary small" disabled={busy} onClick={()=>setGenerator({course:selected,offerSetup:false})}><ListChecks size={15}/> Generate activities</button>
                <button className="btn secondary small" onClick={()=>openCourseForm(selected)}><Pencil size={15}/> Edit</button>
                <button className="btn secondary small" onClick={()=>setDialog('archive')} disabled={busy}><Archive size={15}/> Archive</button>
              </>}
            </div>
          </div>
          {workspaceTab==='exam'?<ExamHero course={selected} courseDone={courseDoneCount} courseTotal={progressCourseItems.length} revisionDone={examDoneCount} revisionTotal={examProgressItems.length} onEdit={isReadOnly?undefined:()=>openCourseForm(selected)}/>:<><div className="planner-hero planner-study-hero">
            <div><span>WEEK {weekNumber} · CONTINUE LEARNING</span><h3>{week?.title||`Continue with Week ${weekNumber}`}</h3>{week?.objectives&&<p>{week.objectives}</p>}</div>
            <div className="planner-hero-progress"><span className="planner-progress-scope">Course progress</span>{progressCourseItems.length?<><strong><ProgressValue key={selectedId} value={courseCompletion}/></strong><small>{courseDoneCount}/{progressCourseItems.length} course activities</small><ProgressTrack key={selectedId} identity={selectedId} value={courseCompletion} label="Course completion"/></>:<small className="planner-no-learning-activities">No learning activities yet</small>}</div>
          </div>
          <div className="planner-week-toolbar planner-study-week-toolbar">{weekPicker}{weekEditButton}</div></>}
          <nav className="planner-tabbar planner-study-tabs" aria-label="Course workspace sections">{([
            ['overview','Overview',BookOpen],['course-library','Course library',Library],
            ['week-resources','Week resources',FolderOpen],['tasks','Study tasks',ListChecks],
            ['exam','Exam prep',GraduationCap]
          ] as const).map(([key,label,Icon])=><button key={key} className={workspaceTab===key?'active':''} aria-current={workspaceTab===key?'page':undefined} onClick={()=>setWorkspaceTab(key)}><Icon size={16}/>{label}</button>)}</nav>
          {workspaceTab==='overview'&&<div className="planner-main-grid planner-study-overview planner-classic-overview">
            <Card className="planner-study-week-card planner-learning-checklist">
              <div className="planner-classic-card-title"><h3>Weekly learning checklist</h3><div className="planner-classic-heading-actions">
                <button type="button" className="btn secondary small planner-filter-toggle" aria-expanded={filtersOpen} aria-controls="study-activity-filters" title="Filter weekly activities" onClick={()=>setFiltersOpen(value=>!value)}><ListFilter size={15}/>{activityFilter==='all'?'Filter':activityFilter[0].toUpperCase()+activityFilter.slice(1)}</button>
                {!isReadOnly&&<button className="btn secondary small" onClick={()=>openActivityForm()}><Plus size={15}/> Add activity</button>}
              </div></div>
              {progressWeekItems.length>0&&<div className="planner-weekly-progress">
                <span>Week {weekNumber} progress · {weekDoneCount}/{progressWeekItems.length} complete · <ProgressValue key={`${selectedId}-${weekNumber}`} value={weekCompletion}/></span>
                <ProgressTrack key={`${selectedId}-${weekNumber}`} identity={`${selectedId}-${weekNumber}`} value={weekCompletion} label={`Week ${weekNumber} completion`}/>
              </div>}
              {filtersOpen&&<div id="study-activity-filters" className="planner-study-filters" aria-label="Filter weekly activities">{(['all','planned','due','completed'] as const).map(filter=><button key={filter} type="button" className={activityFilter===filter?'active':''} aria-pressed={activityFilter===filter} onClick={()=>setActivityFilter(filter)}>{filter[0].toUpperCase()+filter.slice(1)}</button>)}</div>}
              {filteredItems.length?filteredItems.map(i=>{
                const status=activityStatus(i,today);
                const reference=activityReference(i);
                const fallback=categoryInTitle(i.title,i.kind)?null:activityKindFallback(i);
                const documents=activityResources(i,data.resources);
                return <div className={'planner-task-row planner-study-task planner-activity-detail task-completion-row'+(!reference&&!fallback&&!i.notes?.trim()&&!documents.length&&i.page_start==null&&i.page_end==null&&!i.planned_date&&!i.due_date?' compact-activity':'')+(status==='overdue'?' overdue':'')+(landingItem?.id===i.id?' planner-target-item':'')+(completingIds.has(i.id)?' is-completing':'')+((activityFilter==='planned'||activityFilter==='due')&&exitingIds.has(i.id)?' is-exiting':'')} ref={landingItem?.id===i.id?landingRef:undefined} key={i.id}>
                  <input type="checkbox" disabled={isReadOnly||busy||pendingItems.has(i.id)||completingIds.has(i.id)} className="task-completion-check" checked={i.done||completingIds.has(i.id)} onChange={()=>toggleItem(i)} aria-label={`Complete ${i.title}`}/>
                  <div className="planner-activity-content">
                    <div className="planner-activity-heading"><strong className={i.done?'complete':''}>{i.title}</strong>{status!=='none'&&<span className={`planner-activity-pill ${status}`}>{activityStatusLabel(status)}</span>}</div>
                    {reference?<div className="planner-activity-reference">{reference}</div>:fallback&&<div className="planner-activity-kind">{fallback}</div>}
                    {(i.page_start!=null||i.page_end!=null||i.planned_date||i.due_date)&&<div className="planner-activity-metadata">
                      {(i.page_start!=null||i.page_end!=null)&&<span><BookOpen size={13} aria-hidden="true"/> Pages {i.page_start??'…'}{i.page_end!=null&&i.page_end!==i.page_start?`–${i.page_end}`:''}</span>}
                      {i.planned_date&&<span><CalendarDays size={13} aria-hidden="true"/> Planned {shortStudyDate(i.planned_date)}</span>}
                      {i.due_date&&<span><CalendarDays size={13} aria-hidden="true"/> Due {shortStudyDate(i.due_date)}</span>}
                    </div>}
                    {documents.map(document=><div className="planner-activity-document-row" key={document.id}><button type="button" className="planner-activity-document" onClick={()=>openResource(document)} title={`Open ${document.title}`}><FileText size={16} aria-hidden="true"/><span>{document.title}</span><ExternalLink size={15} aria-hidden="true"/></button>{!isReadOnly&&<button type="button" className="icon-btn" disabled={busy||pendingItems.size>0} onClick={()=>void detachResource(document,i)} title="Unlink from activity" aria-label={`Unlink ${document.title}`}><Unlink size={15}/></button>}</div>)}
                    {i.notes?.trim()&&<details className="planner-activity-notes"><summary><NotebookPen size={14} aria-hidden="true"/><span>Notes{` · ${i.notes.trim().split('\n')[0].slice(0,72)}`}</span><ChevronDown size={15} className="planner-notes-chevron" aria-hidden="true"/></summary><p>{i.notes}</p></details>}
                  </div>
                  {!isReadOnly&&<div className="planner-activity-actions" role="group" aria-label={`${i.title} actions`}>
                    <button className="icon-btn" disabled={busy||pendingItems.has(i.id)} onClick={()=>openActivityForm(i)} title={`Edit ${i.title}`} aria-label={`Edit ${i.title}`}><Pencil size={16}/></button>
                    <button className="icon-btn" disabled={busy||i.done||pendingItems.has(i.id)||completingIds.has(i.id)} onClick={()=>openActivityPlan(i)} title={i.planned_date?`Reschedule ${i.title}`:`Plan ${i.title}`} aria-label={`Plan ${i.title}`}><CalendarDays size={16}/></button>
                    <button className="icon-btn" disabled={busy} aria-label={`Focus on ${i.title}`} title={`Focus on ${i.title}`} onClick={()=>focusOn(i)}><Timer size={16}/></button>
                    <button className="icon-btn danger-hover" disabled={busy} aria-label={`Delete ${i.title}`} title={`Delete ${i.title}`} onClick={()=>void deleteItem(i)}><Trash2 size={16}/></button>
                  </div>}
                </div>;
              }):<EmptyState icon={<CheckCircle2 size={23}/>} title={items.length?'No activities in this filter':'A fresh week'} detail={items.length?'Choose All to see every weekly activity.':'Add a lecture, reading, question set, or revision activity to begin.'}/>}
            </Card>
            <div className="stack planner-study-side-cards">
              <Card className="planner-study-week-resources-card planner-resource-preview-card">
                <div className="planner-classic-card-title"><h3>This week’s files</h3><button type="button" className="planner-inline-link" onClick={()=>setWorkspaceTab('week-resources')}>View all <ArrowRight size={15}/></button></div>
                {weekResources.slice(0,2).map(resourcePreviewRow)}
                {!weekResources.length&&<p className="planner-study-hint">No files linked to Week {weekNumber} yet.</p>}
                {weekResources.length>2&&<span className="planner-resource-preview-count">Showing 2 of {weekResources.length} week files</span>}
                {!isReadOnly&&<button type="button" className="btn secondary full planner-resource-footer" onClick={()=>openResourceForm('week')}><Plus size={15}/> Link week material</button>}
              </Card>
              <Card className="planner-study-shared-library-card planner-resource-preview-card">
                <div className="planner-classic-card-title"><h3>Course library</h3><Badge>{shared.length} {shared.length===1?'file':'files'}</Badge></div>
                {shared.length>0&&<p className="planner-resource-preview-caption">Reference files for all teaching weeks</p>}
                <div className="planner-resource-preview-list">
                  {sharedPreview.map(resourcePreviewRow)}
                  {!shared.length&&<p className="planner-study-hint">No course-wide references yet. Add textbooks and notebooks in Course Library. Exam papers are in Exam Prep.</p>}
                </div>
                {shared.length>sharedPreview.length&&<span className="planner-resource-preview-count">Showing {sharedPreview.length} of {shared.length} files</span>}
                <button type="button" className="btn secondary full planner-resource-footer" onClick={()=>setWorkspaceTab('course-library')}><Library size={15}/> Open Course Library</button>
              </Card>
            </div>
          </div>}
          {workspaceTab==='course-library'&&<Card className="planner-library-panel"><SectionTitle title="Course Library" aside={!isReadOnly&&<button className="btn primary small" onClick={()=>openResourceForm('course')}><Plus size={14}/> Add shared resource</button>}/>
            {shared.length?shared.map(resourceRow):<PhotoEmptyState scene="resources" title="No resources yet" detail="Link your textbooks, slides, and Goodnotes PDFs here." actionLabel={isReadOnly?undefined:'Add resource'} onAction={isReadOnly?undefined:()=>openResourceForm('course')}/>}
            {!isReadOnly&&<button className="btn secondary full" onClick={()=>openDrive(selected.id,weekNumber,'textbook','course')}><Cloud size={16}/> Browse Goodnotes backups for this course</button>}
          </Card>}
          {workspaceTab==='week-resources'&&<Card><SectionTitle title={`Week ${weekNumber} resources`} aside={!isReadOnly&&<button className="btn primary small" onClick={()=>openResourceForm('week')}><Plus size={14}/> Add link</button>}/>
            {weekResources.length?weekResources.map(resourceRow):<PhotoEmptyState scene="study" title="No weekly materials" detail="Link lecture slides or annotated PDFs for this week." actionLabel={isReadOnly?undefined:'Add resource'} onAction={isReadOnly?undefined:()=>openResourceForm('week')}/>}
            {!isReadOnly&&<button className="btn secondary full" onClick={()=>openDrive(selected.id,weekNumber,'annotated','week')}><Cloud size={16}/> Browse Goodnotes backups</button>}
          </Card>}
          {workspaceTab==='tasks'&&<Card className="planner-course-tasks-card"><SectionTitle title="Course study tasks" aside={!isReadOnly&&<button className="btn primary small" onClick={()=>{openActivityForm();setItemDraft({...itemDraftDefaults,kind:'assignment',is_task:true});}}><Plus size={14}/> Add task</button>}/>
            <p className="planner-course-task-summary">{actionableCourseItems.length} {actionableCourseItems.length===1?'task':'tasks'} · {actionableCourseItems.filter(i=>i.done).length} completed</p>
            <div className="planner-course-task-filters" role="group" aria-label="Filter course study tasks">{(['all','week','exam'] as const).map(filter=><button key={filter} type="button" className={courseTaskFilter===filter?'active':''} aria-pressed={courseTaskFilter===filter} onClick={()=>setCourseTaskFilter(filter)}>{filter==='all'?'All':filter==='week'?'This week':'Exam prep'}</button>)}</div>
            <div className="planner-course-task-list">{filteredCourseTasks.map(renderCourseTask)}</div>
            {!filteredCourseTasks.length&&<EmptyState icon={<CalendarDays size={24}/>} title={actionableCourseItems.length?'Nothing in this filter':'No scheduled work'} detail={actionableCourseItems.length?'Choose All to see the other course tasks.':'Add assignments or schedule a revision activity.'}/>}
          </Card>}
          {workspaceTab==='exam'&&<div className="planner-exam-grid"><Card className="planner-exam-card"><SectionTitle title="Revision checklist" aside={<Badge>{examDoneCount}/{examProgressItems.length} completed</Badge>}/>

            {examItems.length>0&&<ProgressTrack className="planner-exam-progress" identity={`${selectedId}-exam`} label="Exam revision completion" value={checklistPercent(examDoneCount,examProgressItems.length)}/>}
            <div className="planner-course-task-list">{examItems.map(renderCourseTask)}</div>
            {!examItems.length&&<EmptyState icon={<BookMarked size={23}/>} title="Exam preparation starts here" detail="Add topics and course-wide revision tasks."/>}
            {!isReadOnly&&(examEntryOpen?<form className="exam-task-form" onSubmit={e=>void saveExam(e)}><input aria-label="Exam preparation task" autoFocus placeholder="Practise old exam papers" value={examTitle} onChange={e=>setExamTitle(e.target.value)} required/><button className="btn primary small" disabled={busy||!examTitle.trim()} aria-busy={busy}>{busy?<><LoaderCircle size={14} className="spin"/> Saving…</>:'Add task'}</button><button type="button" className="btn secondary small" disabled={busy} onClick={()=>{setExamEntryOpen(false);setExamTitle('');}}>Cancel</button></form>:<button type="button" className="btn secondary planner-exam-add" onClick={()=>setExamEntryOpen(true)}><Plus size={16}/> Add revision task</button>)}
          </Card>
            <ExamPapers key={selected.id} papers={examResources.filter(r=>r.kind==='exam_paper')}
              solutions={examResources.filter(r=>r.kind==='exam_solution')}
              editResource={r=>openResourceForm(r.week_number==null?'course':'week',r)} removeResource={removeResource}
              addSolution={paper=>openDrive(selected.id,weekNumber,'exam_solution','course',paper.id)}
              user={user} busy={busy} readOnly={isReadOnly} run={run} openResource={openResource}
              browseDrive={()=>openDrive(selected.id,weekNumber,'exam_paper','course')} practice={preparePractice}
              examDuration={selected.exam_duration_minutes} activeFocus={activeFocus} focusBusy={focusBusy} openFocus={openFocus}/>
            <div className="planner-exam-side">
              <Card><SectionTitle title="Exam focus this week"/>
                <strong className="exam-focus-value">{Math.floor(examFocusSeconds/3600)}h {Math.floor(examFocusSeconds%3600/60)}m</strong>
                <p className="planner-study-hint">Finished sessions linked to revision tasks since Monday.</p>
              </Card>
              <Card><SectionTitle title="Exam resources"/>
                {sharedPreview.map(resourcePreviewRow)}
                <button className="btn secondary full" onClick={()=>setWorkspaceTab('course-library')}>Open course library <ArrowRight size={15}/></button>
              </Card>
            </div>
          </div>}
        </>}
      </div>
    </div>

    {removalResource&&<ResourceRemovalDialog key={removalResource.id} resource={removalResource} user={user} busy={busy||pendingItems.size>0} run={run} onClose={()=>setRemovalResource(null)}/>}
    {deletionCourse&&<CourseDeletionDialog key={deletionCourse.id} course={deletionCourse} user={user} busy={busy} run={run} onClose={()=>setDeletionCourse(null)} onDeleted={()=>{
      setDeletionCourse(null);setWorkspaceTab('overview');
      const next=matching.find(c=>c.id!==deletionCourse.id&&c.archived);
      if(next){selectCourse(next.id);}else{setShowArchived(false);selectCourse(matching.find(c=>!c.archived)?.id||'');}
    }}/>}
    {generator&&<ActivityGenerator key={generator.course.id} course={data.courses.find(c=>c.id===generator.course.id)||generator.course} items={progressItems} busy={busy} offerSetup={generator.offerSetup} onClose={()=>setGenerator(null)} onGenerate={(activities,weeks)=>generate(generator.course,activities,weeks)}/>}
    {dialog&&<div className="dialog-backdrop" role="presentation"><div className="dialog planner-dialog" role="dialog" aria-modal="true" aria-label={`${dialog} configuration`}>
      <button className="dialog-close" disabled={busy} onClick={closeDialog} aria-label="Close dialog"><X size={18}/></button>
      {dialog==='semester'&&<><h2>{semDraft.id?'Edit semester':'Add semester'}</h2><form onSubmit={e=>void saveSemester(e)}><FormRow label="Semester name"><input autoFocus required maxLength={60} placeholder="Autumn 2026" value={semDraft.name} onChange={e=>setSemDraft(p=>({...p,name:e.target.value}))}/></FormRow><div className="form-grid"><FormRow label="Starts (optional)"><input type="date" value={semDraft.start_date} onChange={e=>setSemDraft(p=>({...p,start_date:e.target.value}))}/></FormRow><FormRow label="Ends (optional)"><input type="date" value={semDraft.end_date} onChange={e=>setSemDraft(p=>({...p,end_date:e.target.value}))}/></FormRow></div><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin" aria-hidden="true"/> Saving…</>:'Save semester'}</button></div></form></>}
      {dialog==='course'&&<><h2>{editCourseId?'Edit course':'Add course'}</h2><form onSubmit={e=>void saveCourse(e)}><div className="form-grid planner-course-form-grid"><FormRow label="Course code"><input required maxLength={40} value={courseDraft.code} placeholder="02516" onChange={e=>setCourseDraft(p=>({...p,code:e.target.value}))}/></FormRow><FormRow label="Teaching weeks"><input required type="number" min={1} max={30} value={courseDraft.week_count} onChange={e=>setCourseDraft(p=>({...p,week_count:Number(e.target.value)}))}/></FormRow><div className="planner-form-full"><FormRow label="Course title"><input required maxLength={180} value={courseDraft.title} onChange={e=>setCourseDraft(p=>({...p,title:e.target.value}))} placeholder="Image Analysis & Computer Vision"/></FormRow></div><FormRow label="Semester"><select required value={courseDraft.semester_key} onChange={e=>setCourseDraft(p=>({...p,semester_key:e.target.value}))}>{semesterOptions.map(s=><option key={s.key} value={s.key}>{s.name}</option>)}</select></FormRow><FormRow label="Exam date (optional)"><input type="date" value={courseDraft.exam_date} onChange={e=>setCourseDraft(p=>({...p,exam_date:e.target.value}))}/></FormRow><FormRow label="Exam start time (optional)"><input type="time" value={courseDraft.exam_time} onChange={e=>setCourseDraft(p=>({...p,exam_time:e.target.value}))}/></FormRow><FormRow label="Exam duration (minutes)"><input type="number" min={1} max={720} value={courseDraft.exam_duration_minutes} onChange={e=>setCourseDraft(p=>({...p,exam_duration_minutes:e.target.value}))}/></FormRow><FormRow label="Exam format (optional)"><input maxLength={80} placeholder="Written / oral" value={courseDraft.exam_format} onChange={e=>setCourseDraft(p=>({...p,exam_format:e.target.value}))}/></FormRow><FormRow label="Exam location (optional)"><input maxLength={240} value={courseDraft.exam_location} onChange={e=>setCourseDraft(p=>({...p,exam_location:e.target.value}))}/></FormRow><div className="planner-form-full"><FormRow label="Study goals (optional)"><textarea rows={3} maxLength={2000} value={courseDraft.goals} onChange={e=>setCourseDraft(p=>({...p,goals:e.target.value}))}/></FormRow></div></div><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin" aria-hidden="true"/> Saving…</>:'Save course'}</button></div></form></>}
      {dialog==='archive'&&selected&&<><h2>Archive {selected.code}?</h2><p>It will disappear from your active planner. Unfinished tasks won't appear in Today. All notes, documents, week progress and focus history will be kept.</p><div className="planner-archive-preview"><span>{linkedCounts.items} study items</span><span>{linkedCounts.documents} resource links</span><span>{linkedCounts.sessions} focus sessions</span></div><div className="form-actions"><button className="btn secondary" onClick={()=>setDialog(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={()=>void archive()}><Archive size={15}/> Archive course</button></div></>}
      {dialog==='week'&&<><h2>Week {weekNumber} details</h2><form onSubmit={e=>void saveWeek(e)}><FormRow label="Topic"><input required value={weekDraft.title} placeholder="Multiclass segmentation" onChange={e=>setWeekDraft(p=>({...p,title:e.target.value}))}/></FormRow><FormRow label="Learning objectives"><textarea rows={3} value={weekDraft.objectives} onChange={e=>setWeekDraft(p=>({...p,objectives:e.target.value}))}/></FormRow><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button className="btn primary" disabled={busy} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin"/> Saving…</>:'Save week'}</button></div></form></>}
      {dialog==='plan-item'&&planItem&&<><h2>Plan study activity</h2><p><strong>{planItem.title}</strong> · {planItem.week_number!==null?`Week ${planItem.week_number}`:'Exam preparation'}</p>
        <div className="form-actions planner-plan-quick"><button className="btn secondary" disabled={busy||Boolean(planItem.due_date&&localToday()>planItem.due_date)} title={planItem.due_date&&localToday()>planItem.due_date?`Deadline passed on ${formatDate(planItem.due_date)}; cannot schedule today`:undefined} onClick={()=>void updateActivityPlan(localToday())}><CalendarDays size={15}/> Plan for today</button></div>
        <form onSubmit={e=>{e.preventDefault();if(planDate)void updateActivityPlan(planDate);}}><FormRow label="Choose a planned date"><input type="date" required max={planItem.due_date||undefined} value={planDate} onChange={e=>setPlanDate(e.target.value)}/></FormRow><div className="form-actions">{planItem.planned_date&&<button type="button" className="btn secondary" disabled={busy} onClick={()=>void updateActivityPlan(null)}>Clear date</button>}<button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button className="btn primary" type="submit" disabled={busy||!planDate||Boolean(planItem.due_date&&planDate>planItem.due_date)}>{busy?<><LoaderCircle size={15} className="spin"/> Saving…</>:'Save plan'}</button></div></form>
        {planItem.due_date&&<p className="planner-plan-note">This activity must be planned no later than {formatDate(planItem.due_date)}.</p>}
        {planItem.planned_date&&<p className="planner-plan-note">Clearing the date keeps this activity in the Tasks inbox as unscheduled work.</p>}
      </>}
      {dialog==='item'&&<><h2>{editActivityId?'Edit study activity':'New study activity'}</h2><p>Reading, notes, and questions can reference a shared book or notebook.</p><form onSubmit={e=>void saveItem(e)}><FormRow label="Title"><input required value={itemDraft.title} onChange={e=>setItemDraft(p=>({...p,title:e.target.value}))}/></FormRow><div className="form-grid"><FormRow label="Activity type">{editingExamPrep?<><input value="Exam preparation" readOnly aria-readonly="true"/></>:<select value={itemDraft.kind} onChange={e=>setItemDraft(p=>({...p,kind:e.target.value as Item['kind']}))}>{(['lecture','notes','reading','questions','revision','assignment','exercise'] as const).map(kind=><option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select>}</FormRow><FormRow label="Reference a shared book or notebook"><select value={itemDraft.resource_id} onChange={e=>setItemDraft(p=>({...p,resource_id:e.target.value}))}><option value="">No linked document</option>{[...allShared,...weekResources].filter(r=>editingExamPrep||!isExamResource(r.kind)).map(r=><option value={r.id} key={r.id}>{r.title}{r.week_number!==null?` (Week ${r.week_number})`:""}</option>)}</select></FormRow><FormRow label={itemDraft.kind==='questions'?'Question numbers':'Chapter / section'}><input value={itemDraft.chapter} placeholder={itemDraft.kind==='questions'?'3, 4, 5.6, 4.2.1':undefined} onChange={e=>setItemDraft(p=>({...p,chapter:e.target.value}))}/></FormRow><FormRow label="Pages from"><input type="number" min={1} value={itemDraft.page_start} onChange={e=>setItemDraft(p=>({...p,page_start:e.target.value}))}/></FormRow><FormRow label="Pages to"><input type="number" min={1} value={itemDraft.page_end} onChange={e=>setItemDraft(p=>({...p,page_end:e.target.value}))}/></FormRow><FormRow label="Planned date"><input type="date" max={itemDraft.due_date||undefined} value={itemDraft.planned_date} onChange={e=>setItemDraft(p=>({...p,planned_date:e.target.value}))}/></FormRow><FormRow label="Due date"><input type="date" min={itemDraft.planned_date||undefined} value={itemDraft.due_date} onChange={e=>setItemDraft(p=>({...p,due_date:e.target.value}))}/></FormRow></div><FormRow label="Notes (optional)"><textarea rows={3} maxLength={5000} placeholder="Quick notes, lecture takeaways or reference details" value={itemDraft.notes} onChange={e=>setItemDraft(p=>({...p,notes:e.target.value}))}/></FormRow><label className="inline-check"><input type="checkbox" checked={!itemDraft.hidden_from_tasks&&(itemDraft.kind==='assignment'||itemDraft.is_task||!!itemDraft.planned_date||!!itemDraft.due_date)} onChange={e=>setItemDraft(p=>({...p,is_task:e.target.checked,hidden_from_tasks:!e.target.checked}))}/> Include in Tasks and Calendar</label><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button className="btn primary" disabled={busy||!itemDraft.title.trim()||Boolean(itemDraft.planned_date&&itemDraft.due_date&&itemDraft.planned_date>itemDraft.due_date)} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin"/> Saving…</>:editActivityId?'Save activity':'Add activity'}</button></div></form></>}
      {dialog==='resource'&&<><h2>{resourceEditId?'Edit resource':'Link a resource'}</h2><p>Keep whole-course books and notebooks shared; use weekly links for lecture slides.</p><form onSubmit={e=>void saveResource(e)}><FormRow label="Resource title"><input required value={resourceDraft.title} onChange={e=>setResourceDraft(p=>({...p,title:e.target.value}))}/></FormRow><FormRow label="Available in">{isExamResource(resourceDraft.kind)?(editingResource?.week_number!=null?<select value={resourceScope} onChange={e=>setResourceScope(e.target.value as 'course'|'week')}><option value="week">Exam Prep · original Week {editingResource.week_number}</option><option value="course" disabled={Boolean(editingResource.item_id)}>Exam Prep · course-wide</option></select>:<input value="Exam Prep" readOnly/>):<select value={resourceScope} onChange={e=>setResourceScope(e.target.value as 'course'|'week')}><option value="course">Course Library — all weeks</option><option value="week">Only Week {editingResource?.week_number??weekNumber}</option></select>}</FormRow>{isExamResource(resourceDraft.kind)&&editingResource?.week_number!=null&&editingResource.item_id&&<p className="planner-study-hint">Unlink this file from its weekly activity before moving it to course-wide Exam Prep.</p>}{!editingResource&&<FormRow label="Document URL (HTTPS)"><input type="url" required value={resourceDraft.url} placeholder="https://..." onChange={e=>setResourceDraft(p=>({...p,url:e.target.value}))}/></FormRow>}<div className="form-grid"><FormRow label="Document type"><select value={resourceDraft.kind} onChange={e=>setResourceDraft(p=>({...p,kind:e.target.value as ResourceKind}))}>{(['textbook','handwritten','slides','annotated','exam_paper','exam_solution','other'] as const).map(k=><option key={k} value={k}>{resourceKindLabel(k)}</option>)}</select></FormRow>{!editingResource&&<FormRow label="Source"><select value={resourceDraft.source} onChange={e=>setResourceDraft(p=>({...p,source:e.target.value as 'dtu'|'link'}))}><option value="dtu">DTU Learn</option><option value="link">Other link</option></select></FormRow>}{resourceDraft.kind==='exam_solution'&&<FormRow label="Corresponding question paper"><select value={resourceDraft.exam_paper_id} onChange={e=>setResourceDraft(p=>({...p,exam_paper_id:e.target.value}))}><option value="">Unpaired solution</option>{unavailableEditPaper&&<option value={resourceDraft.exam_paper_id} disabled>Selected paper unavailable</option>}{editPaperOptions.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></FormRow>}{resourceScope==='week'&&!isExamResource(resourceDraft.kind)&&<FormRow label="Attach to study activity"><select value={resourceDraft.item_id} onChange={e=>setResourceDraft(p=>({...p,item_id:e.target.value}))}><option value="">Whole week</option>{items.map(i=><option value={i.id} key={i.id}>{i.title}</option>)}</select></FormRow>}<FormRow label="Chapter"><input value={resourceDraft.chapter} onChange={e=>setResourceDraft(p=>({...p,chapter:e.target.value}))}/></FormRow><FormRow label="Page start"><input type="number" min={1} value={resourceDraft.page_start} onChange={e=>setResourceDraft(p=>({...p,page_start:e.target.value}))}/></FormRow><FormRow label="Page end"><input type="number" min={1} value={resourceDraft.page_end} onChange={e=>setResourceDraft(p=>({...p,page_end:e.target.value}))}/></FormRow></div><div className="form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button type="submit" className="btn primary" disabled={busy||unavailableEditPaper} aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin" aria-hidden="true"/> Saving…</>:'Save link'}</button></div></form></>}
      {busy&&<p className="planner-save-status" role="status" aria-live="polite"><LoaderCircle size={14} className="spin" aria-hidden="true"/> Saving changes to Study Hub…</p>}
    </div></div>}
  </>;
}
