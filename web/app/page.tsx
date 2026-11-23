'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3,
  Cloud, ExternalLink, FileText, Folder, GraduationCap, Home, Link2, ListTodo, LoaderCircle, FolderCheck, ScanSearch,
  Pause, Play, Plus, RotateCcw, Square, Timer, X, Sparkles, Sun, Moon, Target, AlertTriangle, BarChart3, LogOut, PanelLeftClose, PanelLeftOpen, Pencil, Search
} from 'lucide-react';
import { api, pdfBlob } from '@/lib/api';
import { formatLocalClock, formatLocalDate } from '@/lib/clock';
import { applyMutation, type MutationHint } from '@/lib/snapshot-cache';
import { describeSnapshotFailure, fetchSnapshotWithRetry, type SnapshotLoadProblem } from '@/lib/snapshot-loading';
import { Badge, Card, EmptyState, FormRow, SectionTitle } from '@/components/common';
import { PdfWorkspace, PdfOpeningOverlay } from '@/components/pdf-workspace';
import { createPdfRequestGate } from '@/lib/pdf-preview';
import { ProfileName } from '@/components/profile-name';
import { CoursePlanner } from '@/components/course-planner';
import { ProgressTrack, ProgressValue } from '@/components/progress-motion';
import { visibleCourseDoneCount } from '@/lib/progress-presentation';
import { FocusElapsed, FocusDial } from '@/components/focus-elapsed';
import { FocusDurationFields } from '@/components/focus-duration-fields';
import { formatFocusDuration } from '@/lib/focus-display';
import { filterIndexedPdfs, type IndexedPdfFilter } from '@/lib/resource-view';
import {
  previewPause, previewResume, recoverFocusClock, startFocusClock, pauseFocusClock,
  resumeFocusClock, focusClockSeconds, rekeyFocusClock, type FocusClockAnchor,
} from '@/lib/focus-timing';
import { TasksPlanner } from '@/components/tasks-planner';
import { PhotoEmptyState } from '@/components/photo-empty-state';
import { CourseActionsMenu } from '@/components/course-actions-menu';
import { FeedbackToasts, useFeedbackToasts, type FeedbackMessage } from '@/components/feedback-toasts';
import { COMPLETION_HOLD_MS, COMPLETION_EXIT_MS, presentCompletingItems, type CompletionPhase } from '@/lib/task-completion-presentation';
import { isActionable, isOverdue, todayPriorities, upcomingDeadlines, focusTasksForContext } from '@/lib/task-view';
import { activityReference } from '@/lib/activity-display';
import { todayStudyCourses, nextSevenDays, nextDeadlineDays, agendaForDate } from '@/lib/home-view';
import { firebaseAuth, onAuthStateChanged, signIn, signOutUser, useFirebase } from '@/lib/auth';
import { type DriveEntry, type DriveList, type FocusSession, type Item,
  type Resource, type Snapshot, type Tab, type DriveIndexed, type DriveSource, type DriveIndexResponse, type DriveScanResponse, duration,
  formatDate, kindLabels, localToday } from '@/lib/types';

type DriveStatus = { connected: boolean; configured: boolean };
const empty: Snapshot = {courses:[], weeks:[], items:[], resources:[], sessions:[], semesters:[]};
type PdfOpening = {requestId:number;fileId:string;title:string;resourceId?:string;page:number;status:'loading'|'error';message?:string};
const PDF_FETCH_TIMEOUT_MS = 120_000;
const pageNames: Record<Tab,string> = {today:'Home', courses:'Study', tasks:'Tasks', calendar:'Calendar', focus:'Focus', library:'Resources'};
const tabs: {id:Tab; label:string; icon:typeof Home}[] = [
  {id:'today',label:'Home',icon:Home},{id:'courses',label:'Study',icon:BookOpen},
  {id:'tasks',label:'Tasks',icon:ListTodo},{id:'calendar',label:'Calendar',icon:CalendarDays},
  {id:'focus',label:'Focus',icon:Timer},
  {id:'library',label:'Resources',icon:Folder}
];
function dateText(d: string|null|undefined) { return d ? formatDate(d) : '—'; }
export default function Page() {
  const [user,setUser] = useState<User|null>(null);
  const [authReady,setAuthReady] = useState(!useFirebase);
  const [tab,setTab] = useState<Tab>('today');
  const [theme,setTheme] = useState<'light'|'dark'>('dark');
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const [sidebarWidth,setSidebarWidth] = useState<number|null>(null);
  const [sidebarResizing,setSidebarResizing] = useState(false);
  const sidebarDragRef = useRef<{pointerId:number;startX:number;startWidth:number}|null>(null);
  const [data,setData] = useState<Snapshot>(empty);
  const [loading,setLoading] = useState(true);
  const [snapshotReady,setSnapshotReady] = useState(false);
  const [refreshing,setRefreshing] = useState(false);
  const [snapshotIssue,setSnapshotIssue] = useState<SnapshotLoadProblem|null>(null);
  const loadedUserRef=useRef<string|null>(null);
  const loadRequestRef=useRef(0);
  const [busy,setBusy] = useState(false);
  const mutationBusyRef = useRef(false);
  const { messages: feedbackMessages, notify, dismiss: dismissFeedback, clearAll: clearFeedback } = useFeedbackToasts();
  const [focusBusy,setFocusBusy] = useState(false);
  const [focusPreview,setFocusPreview] = useState<FocusSession|null>(null);
  const [focusClock,setFocusClock] = useState<FocusClockAnchor|null>(null);
  const focusBusyRef = useRef(false);
  const focusRevisionRef = useRef(0);
  const [pendingItems,setPendingItems] = useState<Set<string>>(()=>new Set());
  const pendingItemsRef=useRef<Set<string>>(new Set());
  // Presentation-only completion states. Firebase writes still start immediately;
  // active lists keep a successfully completed row until its animation can be seen.
  const [completionPhases,setCompletionPhases] = useState<Record<string,CompletionPhase>>({});
  const completionTimersRef = useRef(new Map<string,{
    minimumElapsed:boolean; saved:boolean; leaving:boolean;
    holdTimer:number; exitTimer?:number;
  }>());
  const clearCompletion = (id:string) => {
    const record=completionTimersRef.current.get(id);
    if(record){window.clearTimeout(record.holdTimer);if(record.exitTimer!==undefined)window.clearTimeout(record.exitTimer);}
    completionTimersRef.current.delete(id);
    setCompletionPhases(previous=>{
      if(!(id in previous))return previous;
      const next={...previous};delete next[id];return next;
    });
  };
  const beginCompletionExit = (id:string) => {
    const record=completionTimersRef.current.get(id);
    if(!record||record.leaving)return;
    record.leaving=true;
    setCompletionPhases(previous=>({...previous,[id]:'leaving'}));
    record.exitTimer=window.setTimeout(()=>clearCompletion(id),COMPLETION_EXIT_MS);
  };
  const startCompletion = (id:string) => {
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    clearCompletion(id);
    const record={minimumElapsed:false,saved:false,leaving:false,holdTimer:0,exitTimer:undefined as number|undefined};
    completionTimersRef.current.set(id,record);
    setCompletionPhases(previous=>({...previous,[id]:'holding'}));
    record.holdTimer=window.setTimeout(()=>{
      record.minimumElapsed=true;
      if(record.saved)beginCompletionExit(id);
    },COMPLETION_HOLD_MS);
  };
  const completionSaved = (id:string) => {
    const record=completionTimersRef.current.get(id);
    if(!record)return;
    record.saved=true;
    if(record.minimumElapsed)beginCompletionExit(id);
  };
  useEffect(()=>()=>{
    for(const record of completionTimersRef.current.values()){
      window.clearTimeout(record.holdTimer);
      if(record.exitTimer!==undefined)window.clearTimeout(record.exitTimer);
    }
    completionTimersRef.current.clear();
  },[]);
  const completingIds=useMemo(()=>new Set(Object.keys(completionPhases)),[completionPhases]);
  const exitingIds=useMemo(()=>new Set(Object.keys(completionPhases).filter(id=>completionPhases[id]==='leaving')),[completionPhases]);
  const lastLoadedAtRef=useRef(0);
  const [error,setError] = useState('');
  const [courseId,setCourseId] = useState('');
  const [weekNumber,setWeekNumber] = useState(1);
  const [now,setNow] = useState(Math.floor(Date.now()/1000));
  const [clockReady,setClockReady] = useState(false);
  const [pdf,setPdf] = useState<{url:string;title:string;page:number;resourceId?:string;courseId?:string;weekNumber?:number}|null>(null);
  const [pdfOpening,setPdfOpening] = useState<PdfOpening|null>(null);
  const pdfRequestGateRef = useRef(createPdfRequestGate());
  const pdfPendingFileRef = useRef<string|null>(null);
  const pdfObjectUrlRef = useRef<string|null>(null);
  const pdfBookmarkTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const pdfBookmarkPendingRef=useRef<{id:string;page:number}|null>(null);
  const pdfBookmarkWriteRef=useRef<Promise<void>>(Promise.resolve());

  const [taskForm,setTaskForm] = useState(false);
  const [priorityFilter,setPriorityFilter] = useState<'all'|'course'|'personal'>('all');
  const courseScrollerRef = useRef<HTMLDivElement | null>(null);
  const [courseScrollIndex, setCourseScrollIndex] = useState(0);
  const [visibleCourseCards, setVisibleCourseCards] = useState(3);
  const [canScrollNextCourse, setCanScrollNextCourse] = useState(true);
  const [quickFocusOpen,setQuickFocusOpen] = useState(false);
  const [quickFocusMode,setQuickFocusMode] = useState<'25'|'50'|'90'|'free'>('25');
  const [quickFocusCourse,setQuickFocusCourse] = useState('');
  const [quickFocusItem,setQuickFocusItem] = useState('');
  const quickFocusRef = useRef<HTMLDivElement|null>(null);
  const [calendarJump,setCalendarJump] = useState<{date:string;token:number}|null>(null);
  const [homeSelectedDate,setHomeSelectedDate] = useState<string|null>(null);
  const [courseLandingItem,setCourseLandingItem] = useState<{id:string;weekNumber:number|null}|null>(null);
  const [taskJump,setTaskJump] = useState<{id:string;token:number}|null>(null);
  const [courseSectionJump,setCourseSectionJump] = useState<{courseId:string;section:'course-library'|'tasks';token:number}|null>(null);
  const [taskLandingMode,setTaskLandingMode] = useState<'today'|'upcoming'|'completed'>('today');
  const [focusCourse,setFocusCourse] = useState('');
  const [focusItem,setFocusItem] = useState('');
  const [focusMode,setFocusMode] = useState<'25'|'50'|'90'|'free'>('50');
  const [finishReview,setFinishReview] = useState(false);
  const [finishSeconds,setFinishSeconds] = useState('0');
  const [reviewLimit,setReviewLimit] = useState(0);
  const [weeklyGoal,setWeeklyGoal] = useState(20);
  const [editingFocusGoal,setEditingFocusGoal] = useState(false);
  useEffect(()=>{
    if(!quickFocusOpen)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setQuickFocusOpen(false);};
    const onOutside=(event:PointerEvent)=>{
      if(quickFocusRef.current&&!quickFocusRef.current.contains(event.target as Node))setQuickFocusOpen(false);
    };
    document.addEventListener('keydown',onKey);
    document.addEventListener('pointerdown',onOutside);
    return ()=>{document.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onOutside);};
  },[quickFocusOpen]);

  const [drive,setDrive] = useState<DriveStatus>({connected:false,configured:false});
  const [driveFiles,setDriveFiles] = useState<DriveEntry[]>([]);
  const [folderPath,setFolderPath] = useState<{id:string;name:string}[]>([{id:'root',name:'My Drive'}]);
  const [driveNext,setDriveNext] = useState<string|null>(null);
  const [driveBusy,setDriveBusy] = useState(false);
  const [sourceFolder,setSourceFolder] = useState<DriveSource|null>(null);
  const [driveIndex,setDriveIndex] = useState<DriveIndexed[]>([]);
  const [scanBusy,setScanBusy] = useState(false);
  const scanBusyRef = useRef(false);
  const [indexFilter,setIndexFilter] = useState<IndexedPdfFilter>('unlinked');
  const [indexSearch,setIndexSearch] = useState('');
  const [selectedPdfId,setSelectedPdfId] = useState<string|null>(null);
  const linkIntentRef=useRef<{courseId:string;week:number;scope:'course'|'week';kind:Resource['kind']}|null>(null);
  const [recentlyLinkedIds,setRecentlyLinkedIds]=useState<Set<string>>(()=>new Set());
  const linkPanelRef=useRef<HTMLDivElement|null>(null);
  const [foldersExpanded,setFoldersExpanded] = useState(false);
  const [visibleCount,setVisibleCount] = useState(30);
  const [linkCourse,setLinkCourse] = useState('');
  const [linkWeek,setLinkWeek] = useState(1);
  const [linkScope,setLinkScope] = useState<'course'|'week'>('week');
  const [linkKind,setLinkKind] = useState<Resource['kind']>('handwritten');
  const [linkItem,setLinkItem] = useState('');
  const [linkingFileId,setLinkingFileId] = useState<string|null>(null);

  useEffect(()=>{
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, u=>{
      pendingItemsRef.current.clear();setPendingItems(new Set());
      for(const record of completionTimersRef.current.values()){
        window.clearTimeout(record.holdTimer);
        if(record.exitTimer!==undefined)window.clearTimeout(record.exitTimer);
      }
      completionTimersRef.current.clear();setCompletionPhases({});
      focusBusyRef.current=false;focusRevisionRef.current++;setFocusBusy(false);setFocusPreview(null);setFocusClock(null);
      setFinishReview(false);setQuickFocusOpen(false);
      // A previous account's pending PDF must never appear after an auth switch.
      pdfRequestGateRef.current.cancel();pdfPendingFileRef.current=null;
      if(pdfBookmarkTimerRef.current){clearTimeout(pdfBookmarkTimerRef.current);pdfBookmarkTimerRef.current=null;}
      pdfBookmarkPendingRef.current=null;
      if(pdfObjectUrlRef.current)URL.revokeObjectURL(pdfObjectUrlRef.current);
      pdfObjectUrlRef.current=null;setPdf(null);setPdfOpening(null);
      clearFeedback();
      setUser(u);setAuthReady(true);
    });
  },[]);
  useEffect(()=>{
    // Render the clock only after hydration to avoid server/client time mismatches.
    setNow(Math.floor(Date.now()/1000));
    setClockReady(true);
    // FocusElapsed owns the second-level clock: do not rerender the full planner on every tick.
    const refresh = () => setNow(Math.floor(Date.now()/1000));
    const id=window.setInterval(refresh,30000);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{clearInterval(id);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  useEffect(()=>{
    const preference=window.localStorage.getItem('studyhub-theme');
    if(preference==='dark'||preference==='light')setTheme(preference);
  },[]);
  const toggleTheme=()=>setTheme(previous=>{const next=previous==='light'?'dark':'light';window.localStorage.setItem('studyhub-theme',next);return next;});
  // Apply the active theme to the document too: iOS Safari can expose the root
  // canvas behind the app during overscroll and around the safe areas.
  useEffect(()=>{
    document.documentElement.dataset.studyHubTheme=theme;
    document.documentElement.style.colorScheme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#211a28':'#f7f8fc');
  },[theme]);
  useEffect(()=>{
    try {
      setSidebarCollapsed(window.localStorage.getItem('studyhub-sidebar-collapsed')==='true');
      const saved=Number(window.localStorage.getItem('studyhub-sidebar-width'));
      if(Number.isFinite(saved)&&saved>=205&&saved<=340)setSidebarWidth(saved);
    }catch{ /* Browser storage may be disabled. Keep sensible defaults. */ }
  },[]);
  const clampSidebarWidth=(width:number)=>Math.max(205,Math.min(340,Math.round(width)));
  const toggleSidebar=()=>{
    const next=!sidebarCollapsed;
    setSidebarCollapsed(next);
    try{window.localStorage.setItem('studyhub-sidebar-collapsed',String(next));}catch{}
  };
  const saveSidebarWidth=(width:number|null)=>{
    setSidebarWidth(width);
    try{
      if(width===null)window.localStorage.removeItem('studyhub-sidebar-width');
      else window.localStorage.setItem('studyhub-sidebar-width',String(width));
    }catch{}
  };
  const onSidebarPointerDown=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(event.button!==0)return;
    const width=event.currentTarget.parentElement?.getBoundingClientRect().width??252;
    sidebarDragRef.current={pointerId:event.pointerId,startX:event.clientX,startWidth:width};
    event.currentTarget.setPointerCapture(event.pointerId);
    setSidebarResizing(true);
    event.preventDefault();
  };
  const onSidebarPointerMove=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const drag=sidebarDragRef.current;
    if(drag&&drag.pointerId===event.pointerId)setSidebarWidth(clampSidebarWidth(drag.startWidth+event.clientX-drag.startX));
  };
  const onSidebarPointerEnd=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const drag=sidebarDragRef.current;
    if(!drag||drag.pointerId!==event.pointerId)return;
    if(event.type==='pointerup')saveSidebarWidth(clampSidebarWidth(drag.startWidth+event.clientX-drag.startX));
    else saveSidebarWidth(clampSidebarWidth(drag.startWidth));
    sidebarDragRef.current=null;
    setSidebarResizing(false);
  };
  const onSidebarResizeKey=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
    if(event.key==='Home'){event.preventDefault();saveSidebarWidth(null);return;}
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();
    const current=sidebarWidth??event.currentTarget.parentElement?.getBoundingClientRect().width??252;
    saveSidebarWidth(clampSidebarWidth(current+(event.key==='ArrowRight'?10:-10)));
  };
  useEffect(()=>{
    const stored=window.localStorage.getItem('studyhub-focus-goal');
    if (stored && Number(stored)>=1 && Number(stored)<=80) setWeeklyGoal(Number(stored));
  },[]);

  const load = useCallback(async():Promise<boolean>=>{
    // Do not finish the initial loading state while Firebase is still restoring
    // authentication: otherwise the error screen flashes before the first request.
    if (!authReady) return false;
    if (useFirebase && !user) {
      loadRequestRef.current++;
      loadedUserRef.current=null;
      setData(empty);setSnapshotReady(false);setSnapshotIssue(null);setLoading(false);
      return false;
    }
    const uid=user?.uid||'local';
    const hadSnapshot=loadedUserRef.current===uid;
    const requestNumber=++loadRequestRef.current;
    const focusRevisionAtStart=focusRevisionRef.current;
    if (!hadSnapshot) {
      // Never show data from a previously signed-in account.
      setData(empty);setSnapshotReady(false);setSnapshotIssue(null);setLoading(true);
    } else setRefreshing(true);
    try {
      // Compact response preserves all-time totals while loading only this
      // week's sessions, five recent completions, and the active session.
      const localDay = new Date();
      localDay.setHours(0,0,0,0);
      localDay.setDate(localDay.getDate() - (localDay.getDay()+6)%7);
      const weekStart = Math.floor(localDay.getTime()/1000);
      const snap=await fetchSnapshotWithRetry(()=>api<Snapshot>(`/api/snapshot?compact=true&week_start=${weekStart}`,user,{timeoutMs:15000}));
      if (requestNumber!==loadRequestRef.current) return false;
      // Keep pending checkbox changes visible if a manual refresh finishes mid-save.
      setData(previous=>{
        const items=pendingItemsRef.current.size ? snap.items.map(item=>
          pendingItemsRef.current.has(item.id)?previous.items.find(old=>old.id===item.id)||item:item
        ) : snap.items;
        // An older snapshot must not undo a Focus mutation that committed while it was loading.
        const focusUnchanged = focusRevisionAtStart===focusRevisionRef.current;
        const sessions = focusUnchanged ? snap.sessions : previous.sessions;
        // A snapshot launched before Finish must not roll back its new totals.
        const focus_stats = focusUnchanged ? snap.focus_stats : previous.focus_stats;
        return {...snap,items,sessions,focus_stats};
      });
      lastLoadedAtRef.current=Date.now();
      loadedUserRef.current=uid;
      setSnapshotReady(true);
      setSnapshotIssue(null);
      setCourseId(previous=>{
        const saved=window.localStorage.getItem('studyhub-last-course')||'';
        const preferred=previous||saved;
        return snap.courses.some(c=>c.id===preferred&&!c.archived)?preferred:(snap.courses.find(c=>!c.archived)?.id||'');
      });
      setLinkCourse(previous=>snap.courses.some(c=>c.id===previous&&!c.archived)?previous:(snap.courses.find(c=>!c.archived)?.id||''));
      setError('');
      return true;
    } catch(e) {
      if (requestNumber!==loadRequestRef.current) return false;
      const issue=describeSnapshotFailure(e);
      setSnapshotIssue(issue);
      if (hadSnapshot) setError(`Refresh failed: ${issue.title}. Your last loaded data is still displayed.`);
      else setError('');
      return false;
    } finally {
      if (requestNumber===loadRequestRef.current) {setLoading(false);setRefreshing(false);}
    }
  },[authReady,user]);
  useEffect(()=>{void load();},[load]);
  // Refresh after returning to the tab so changes from another device become visible.
  useEffect(()=>{
    const refreshOnReturn=()=>{
      // Switching browser tabs repeatedly should not download six collections each time.
      if(document.visibilityState==='visible'&&!busy&&Date.now()-lastLoadedAtRef.current>=30000)void load();
    };
    document.addEventListener('visibilitychange',refreshOnReturn);
    return ()=>document.removeEventListener('visibilitychange',refreshOnReturn);
  },[load,busy]);

  // Collection-scoped mutations remove an otherwise mandatory six-collection refresh.
  // Other operations keep the existing full refresh for compatibility.
  const act = async(fn:()=>Promise<unknown>, mutation?:MutationHint, feedback?:FeedbackMessage):Promise<boolean>=>{
    // An immediate ref guard prevents double submits before React commits busy=true.
    if (mutationBusyRef.current) return false;
    mutationBusyRef.current=true;
    setBusy(true);setError('');
    const uid=user?.uid||'local';
    const sameUser=()=>!useFirebase||firebaseAuth?.currentUser?.uid===uid;
    try {
      const result=await fn();
      if(!sameUser())return false;
      let synchronized = true;
      if(mutation){
        if(mutation.collection!=='none') {
          if(!mutation.deleteId&&(!result||typeof result!=='object'||!('id' in result))){
            // A write may have succeeded even if the response shape changed. Reconcile once.
            synchronized=await load();
          }else setData(previous=>applyMutation(previous,mutation,result));
        }
      } else synchronized=await load();
      if(!synchronized) {
        notify({kind:'error',title:'Saved, but sync failed',detail:'Your change may be saved. Refresh to verify before trying again.'});
        return true; // Avoid creating a duplicate if the user retries a successful write.
      }
      if(feedback)notify({kind:'success',...feedback});
      return true;
    } catch(e) {
      if(sameUser())notify({kind:'error',title:'Could not save changes',detail:e instanceof Error?e.message:'Please try again. Your edits are still here.'});
      return false;
    } finally {mutationBusyRef.current=false;setBusy(false);}
  };
  const scrollCourses = (direction: -1 | 1) => {
    const scroller = courseScrollerRef.current;
    if (!scroller) return;
    const card = scroller.querySelector<HTMLElement>('.home-course-tile');
    if (!card) return;
    const gap = Number.parseFloat(window.getComputedStyle(scroller).columnGap) || 0;
    scroller.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap), behavior: 'smooth' });
  };
  const syncCourseScroll = () => {
    const scroller = courseScrollerRef.current;
    const card = scroller?.querySelector<HTMLElement>('.home-course-tile');
    if (!scroller || !card) return;
    const gap = Number.parseFloat(window.getComputedStyle(scroller).columnGap) || 0;
    const cardStep = card.getBoundingClientRect().width + gap;
    setCourseScrollIndex(Math.round(scroller.scrollLeft / cardStep));
    setVisibleCourseCards(Math.max(1, Math.round((scroller.clientWidth + gap) / cardStep)));
    setCanScrollNextCourse(scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2);
  };
  const selectedCourse = data.courses.find(c=>c.id===courseId&&!c.archived);
  const activeCourseIds = useMemo(()=>new Set(data.courses.filter(c=>!c.archived).map(c=>c.id)),[data.courses]);
  // An optimistic write updates canonical data immediately. Only the *list projection*
  // temporarily treats the animating item as open, so it doesn't vanish mid-checkmark.
  const presentedItems=useMemo(()=>presentCompletingItems(data.items,completionPhases),[data.items,completionPhases]);
  const tasks = useMemo(()=>presentedItems.filter(i=>isActionable(i)&&(!i.course_id||activeCourseIds.has(i.course_id))),[presentedItems,activeCourseIds]);
  const today=localToday();
  const openTasks = useMemo(()=>tasks.filter(i=>!i.done),[tasks]);
  const todayWork = useMemo(()=>todayPriorities(openTasks,today),[openTasks,today]);
  const overdue = useMemo(()=>todayWork.filter(i=>isOverdue(i,today)),[todayWork,today]);
  const upcoming = useMemo(()=>upcomingDeadlines(openTasks,today),[openTasks,today]);
  const studyGroups = useMemo(()=>todayStudyCourses(data.courses,presentedItems,today),[data.courses,presentedItems,today]);
  const completedItemIds = useMemo(()=>new Set(data.items.filter(item=>item.done).map(item=>item.id)),[data.items]);
  useEffect(() => {
    // Keep carousel labels accurate across responsive breakpoints and data changes.
    const refresh = () => syncCourseScroll();
    refresh();
    window.addEventListener('resize', refresh);
    return () => window.removeEventListener('resize', refresh);
  }, [studyGroups.length, tab, snapshotReady]);
  const calendarDays=useMemo(()=>nextSevenDays(today,openTasks),[today,openTasks]);
  const homeAgenda=useMemo(()=>homeSelectedDate?agendaForDate(openTasks,homeSelectedDate):[],[homeSelectedDate,openTasks]);
  const filteredPriorities=useMemo(()=>todayWork.filter(i=>priorityFilter==='all'||(priorityFilter==='course'?!!i.course_id:!i.course_id)),[todayWork,priorityFilter]);
  const hour=new Date(now*1000).getHours();
  const hello=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  const firstName=user?.displayName?.trim().split(/\s+/)[0]||'';
  const profileName=user?.displayName?.trim()||'Study Hub';
  const profileInitials=profileName.split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('');
  const dateLabel=clockReady?formatLocalDate(now*1000):'—';
  const timeLabel=clockReady?formatLocalClock(now*1000):'--:--';
  const active=focusPreview??data.sessions.find(s=>s.status==='running'||s.status==='paused');
  // A Firestore snapshot only initializes a clock when it truly represents a
  // new session or externally changed status; local API responses never reset
  // the clock's fractional second and therefore cannot make it jump backward.
  useEffect(()=>{
    setFocusClock(previous=>{
      if(!active)return null;
      if(previous?.sessionId===active.id&&previous.status===active.status)return previous;
      return recoverFocusClock(active,Date.now(),performance.now());
    });
  },[active?.id,active?.status,active?.started_at,active?.pause_started_at,active?.accumulated_pause_seconds]);
  const focusClockAt=(session:FocusSession,wallMs:number,monoMs:number)=>
    focusClock?.sessionId===session.id&&focusClock.status===session.status
      ?focusClock:recoverFocusClock(session,wallMs,monoMs);
  const currentWeekStart=useMemo(()=>{const d=new Date();d.setHours(0,0,0,0);const weekday=(d.getDay()+6)%7;d.setDate(d.getDate()-weekday);return Math.floor(d.getTime()/1000);},[today]);
  const {weekSeconds,totalSeconds}=useMemo(()=>{
    let weekly=0,all=0;
    for(const session of data.sessions){
      if(session.status!=='finished')continue;
      const seconds=session.focus_seconds||0;
      all+=seconds;
      if(session.ended_at&&session.ended_at>=currentWeekStart)weekly+=seconds;
    }
    return {weekSeconds:weekly,totalSeconds:data.focus_stats?.total_seconds ?? all};
  },[data.sessions,data.focus_stats,currentWeekStart]);
  const weekPct=Math.min(100,Math.round((weekSeconds/(weeklyGoal*3600))*100));
  const toggle=(item:Item)=>{
    if(pendingItemsRef.current.has(item.id)||completingIds.has(item.id))return;
    if(!item.done)startCompletion(item.id);
    pendingItemsRef.current.add(item.id);
    setPendingItems(new Set(pendingItemsRef.current));
    setError('');
    // Instant feedback across Home, Tasks, Calendar, Course and PDF views.
    setData(previous=>({...previous,items:previous.items.map(i=>i.id===item.id?{...i,done:!item.done}:i)}));
    const activeUid=user?.uid||'local';
    void (async()=>{
      try {
        const saved=await api<Item>(`/api/items/${item.id}`,user,{method:'PATCH',body:{done:!item.done}});
        if(useFirebase&&firebaseAuth?.currentUser?.uid!==activeUid)return;
        setData(previous=>applyMutation(previous,{collection:'items'},saved));
        if(!item.done&&saved.done)completionSaved(item.id);
        else if(!item.done)clearCompletion(item.id);
        if(!item.done&&saved.done&&saved.repeat&&saved.repeat!=='none'){
          // Recurring completion creates a successor on the server. Fetch items only.
          // A failed follow-up read must not undo a successfully committed completion.
          try {
            const allItems=await api<Item[]>('/api/items',user);
            if(useFirebase&&firebaseAuth?.currentUser?.uid!==activeUid)return;
            setData(previous=>({...previous,items:allItems.map(i=>
              pendingItemsRef.current.has(i.id)&&i.id!==item.id?previous.items.find(old=>old.id===i.id)||i:i)}));
          }catch{
            notify({kind:'error',title:'Task saved, sync incomplete',detail:'The next recurring task did not load. Refresh to sync.'});
          }
        }
      }catch(e){
        if(useFirebase&&firebaseAuth?.currentUser?.uid!==activeUid)return;
        // Roll back only the completion bit; don't clobber a concurrent metadata edit.
        clearCompletion(item.id);
        setData(previous=>({...previous,items:previous.items.map(i=>i.id===item.id?{...i,done:item.done}:i)}));
        notify({kind:'error',title:'Task update failed',detail:`${item.title}: ${e instanceof Error?e.message:'Please retry.'}`});
      }finally{
        pendingItemsRef.current.delete(item.id);
        setPendingItems(new Set(pendingItemsRef.current));
      }
    })();
  };
  const rememberCourse=(id:string)=>{
    setCourseId(id);
    if (id) {
      window.localStorage.setItem('studyhub-last-course',id);
      if (id !== courseId) {
        const course=data.courses.find(c=>c.id===id);
        const saved=Number(window.localStorage.getItem(`studyhub-last-week-${id}`));
        setWeekNumber(course && Number.isInteger(saved) && saved>=1 ? Math.min(saved,course.week_count) : 1);
      }
    } else setWeekNumber(1);
  };
  const rememberWeek=(week:number)=>{setWeekNumber(week);if(courseId)window.localStorage.setItem(`studyhub-last-week-${courseId}`,String(week));};
  // On initial load the last course comes from local storage rather than a
  // course-picker click. Restore its week too, without overriding later edits.
  const restoredCourseRef=useRef('');
  useEffect(()=>{
    const course=data.courses.find(c=>c.id===courseId);
    if(!course||restoredCourseRef.current===courseId)return;
    restoredCourseRef.current=courseId;
    const saved=Number(window.localStorage.getItem(`studyhub-last-week-${courseId}`));
    setWeekNumber(Number.isInteger(saved)&&saved>=1?Math.min(saved,course.week_count):1);
  },[courseId,data.courses]);
  const openCourse=(id:string,week?:number,landingItem?:Item,section?:'course-library'|'tasks')=>{
    const course=data.courses.find(c=>c.id===id&&!c.archived);
    if(!course){setTab('courses');return;}
    const saved=Number(window.localStorage.getItem(`studyhub-last-week-${id}`))||1;
    const selected=Math.max(1,Math.min(course.week_count,week||saved));
    setCourseLandingItem(landingItem?{id:landingItem.id,weekNumber:landingItem.week_number}:null);
    setCourseSectionJump(section?previous=>({courseId:id,section,token:(previous?.token||0)+1}):null);
    rememberCourse(id);setWeekNumber(selected);
    window.localStorage.setItem(`studyhub-last-week-${id}`,String(selected));
    setTab('courses');
  };
  // Home date chips and sidebar Calendar share one destination: the selected-day agenda.
  const openCalendarDate=(date:string)=>{
    setTaskForm(false);
    setTaskJump(null);
    setCalendarJump(p=>({date,token:(p?.token||0)+1}));
    setTab('calendar');
  };
  // Course deadlines resolve to their exact semester/course/week and highlight the activity.
  // Personal deadlines stay in Tasks, highlighted without forcing an edit dialog.
  const openDeadlineDestination=(item:Item)=>{
    if(item.course_id && data.courses.some(c=>c.id===item.course_id&&!c.archived)){
      openCourse(item.course_id,item.week_number||undefined,item);
      return;
    }
    setTaskForm(false);
    setTaskLandingMode(item.planned_date===today||item.due_date===today||isOverdue(item,today)?'today':'upcoming');
    setTaskJump(p=>({id:item.id,token:(p?.token||0)+1}));
    setTab('tasks');
  };
  const toggleHomeAgenda=(date:string)=>setHomeSelectedDate(previous=>previous===date?null:date);
  const showUpcomingTasks=()=>{
    setTaskForm(false);
    setTaskJump(null);
    setTaskLandingMode('upcoming');
    setTab('tasks');
  };
  const navigate=(target:Tab)=>{
    setQuickFocusOpen(false);
    if(target==='calendar'){openCalendarDate(today);return;}
    if(target==='tasks'){setTaskLandingMode('today');setTaskJump(null);}
    if(target==='courses')setCourseLandingItem(null);
    // Sidebar Resources is an independent browser, not an earlier course's linking context.
    linkIntentRef.current=null;
    setTaskForm(false);
    setTab(target);
  };
  // Focus actions use an optimistic overlay and a separate in-flight lock: the controls
  // change immediately, without waiting for a six-collection refresh or blocking other UI.
  const focusRequest=async(
    preview:FocusSession|null,route:string,body?:unknown,
    onSuccess?:(saved:FocusSession)=>void,onFailure?:()=>void
  ):Promise<boolean>=>{
    if(focusBusyRef.current)return false;
    focusBusyRef.current=true;focusRevisionRef.current++;
    setFocusBusy(true);setFocusPreview(preview);setError('');
    const uid=user?.uid||'local';
    const sameUser=()=>!useFirebase||firebaseAuth?.currentUser?.uid===uid;
    try {
      const saved=await api<FocusSession>(route,user,{method:'POST',...(body!==undefined?{body}:{})});
      if(!sameUser())return false;
      setData(previous=>{
        const original = previous.sessions.find(s=>s.id===saved.id);
        const changedToFinished = saved.status==='finished' && original?.status!=='finished';
        const next = applyMutation(previous,{collection:'sessions'},saved);
        if (!changedToFinished || !previous.focus_stats) return next;
        return {...next,focus_stats:{...previous.focus_stats,
          total_seconds:previous.focus_stats.total_seconds + Math.max(0,saved.focus_seconds||0),
          completed_sessions:previous.focus_stats.completed_sessions+1}};
      });
      onSuccess?.(saved);
      return true;
    }catch(e){
      if(sameUser()){
        notify({kind:'error',title:'Focus action failed',detail:`${e instanceof Error?e.message:'Please retry.'} Refresh if another tab changed the session.`});
        onFailure?.();
      }
      return false;
    }finally{
      if(sameUser()){
        focusBusyRef.current=false;
        setFocusPreview(null);setFocusBusy(false);
      }
    }
  };
  const startFocus=async(course:string,itemId:string,mode:'25'|'50'|'90'|'free')=>{
    if(active||focusBusyRef.current||busy)return;
    const item=data.items.find(i=>i.id===itemId);
    const wallMs=Date.now();
    const monoMs=performance.now();
    const timestamp=Math.floor(wallMs/1000);
    const optimistic:FocusSession={
      id:`pending-${wallMs}`,course_id:course||null,item_id:itemId||null,
      week_number:item?.week_number||null,mode,status:'running',started_at:timestamp,
      pause_started_at:null,accumulated_pause_seconds:0,ended_at:null,focus_seconds:null
    };
    setQuickFocusOpen(false);
    setFocusClock(startFocusClock(optimistic.id,wallMs,monoMs));
    await focusRequest(optimistic,'/api/sessions/start',{
      item_id:itemId||null,course_id:course||null,week_number:item?.week_number||null,mode,
      requested_at:timestamp
    }, saved=>setFocusClock(previous=>
      previous?.sessionId===optimistic.id ? rekeyFocusClock(previous,saved.id)
        :recoverFocusClock(saved,Date.now(),performance.now())),
    ()=>setFocusClock(null));
  };
  // Explicit course action starts the currently selected timer mode. Existing sessions are never replaced.
  const focusOnCourse=(id:string)=>{
    setFocusCourse(id);setFocusItem('');setTab('focus');
    if(!active&&!busy&&!focusBusyRef.current)void startFocus(id,'',focusMode);
  };
  const startQuickFocus=async()=>{
    if(active){setQuickFocusOpen(false);return;}
    setFocusCourse(quickFocusCourse);setFocusItem(quickFocusItem);setFocusMode(quickFocusMode);
    await startFocus(quickFocusCourse,quickFocusItem,quickFocusMode);
  };
  const startFrom=(i?:Item)=>{
    // Personal tasks have no course; the selector still needs to retain their item ID.
    setFocusCourse(i?.course_id||'');setFocusItem(i?.id||'');
    setTab('focus');
  };
  const beginFocus=()=>void startFocus(focusCourse,focusItem,focusMode);
  const sessionAction=(verb:'pause'|'resume')=>{
    if(!active||focusBusyRef.current)return;
    const wallMs=Date.now();
    const monoMs=performance.now();
    const existing=focusClockAt(active,wallMs,monoMs);
    const nextClock=verb==='pause'
      ?pauseFocusClock(existing,wallMs,monoMs)
      :resumeFocusClock(existing,wallMs,monoMs);
    setFocusClock(nextClock);
    const preview=verb==='pause'
      ?previewPause(active,Math.floor(wallMs/1000))
      :previewResume(active,Math.floor(wallMs/1000));
    const body=verb==='pause'
      ?{displayed_seconds:focusClockSeconds(nextClock,wallMs,monoMs)}
      :{requested_at:Math.floor(wallMs/1000)};
    void focusRequest(preview,`/api/sessions/${active.id}/${verb}`,body,
      undefined,()=>setFocusClock(existing));
  };
  const reviewFinish=()=>{
    if(!active||focusBusyRef.current)return;
    const wallMs=Date.now();
    const monoMs=performance.now();
    const existing=focusClockAt(active,wallMs,monoMs);
    const stopped=pauseFocusClock(existing,wallMs,monoMs);
    const seconds=Math.min(86400,focusClockSeconds(stopped,wallMs,monoMs));
    setFocusClock(stopped);
    setReviewLimit(seconds);setFinishSeconds(String(seconds));setFinishReview(true);
    if(active.status==='running'){
      // Freeze at the clicked second even if the network takes several seconds.
      void focusRequest(previewPause(active,Math.floor(wallMs/1000)),`/api/sessions/${active.id}/pause`,
        {displayed_seconds:seconds},
        saved=>{
          // The backend can only reduce the counted duration, never inflate it.
          const serverLimit=Math.max(0,saved.started_at!==undefined
            ?Math.floor((saved.pause_started_at! - saved.started_at - saved.accumulated_pause_seconds)) :seconds);
          const limit=Math.min(seconds,serverLimit);
          setReviewLimit(limit);
          setFinishSeconds(previous=>String(Math.min(Number(previous)||0,limit)));
          // A server correction is exceptional (e.g. device clock skew); ensure
          // the visible paused stopwatch still agrees with what can be saved.
          if(limit<seconds)setFocusClock(current=>current?.sessionId===active.id
            ?{...current,elapsedMs:limit*1000}:current);
        },()=>{setFocusClock(existing);setFinishReview(false);});
    }
  };
  const discardEmptyFocus=async(identifier:string)=>{
    if(focusBusyRef.current)return;
    focusBusyRef.current=true;
    focusRevisionRef.current++;
    setFocusBusy(true);
    const uid=user?.uid||'local';
    const sameUser=()=>!useFirebase||firebaseAuth?.currentUser?.uid===uid;
    try{
      // Zero-second sessions have no study time to record. Deleting also releases
      // the active-session guard atomically, without changing focus statistics.
      await api<void>(`/api/sessions/${identifier}`,user,{method:'DELETE'});
      if(!sameUser())return;
      setData(previous=>({...previous,sessions:previous.sessions.filter(s=>s.id!==identifier)}));
      setFocusPreview(null);
      setFocusClock(null);
      setFinishReview(false);
      notify({kind:'info',title:'Empty session discarded',detail:'No study time was recorded.'});
    }catch(e){
      if(sameUser())notify({kind:'error',title:'Could not discard session',detail:e instanceof Error?e.message:'Please try again.'});
    }finally{
      if(sameUser()){
        focusBusyRef.current=false;
        setFocusBusy(false);
      }
    }
  };
  const finish=()=>{
    if(!active||focusBusyRef.current||active.status!=='paused')return;
    const confirmed=Number(finishSeconds);
    if(!Number.isInteger(confirmed)||confirmed<0||confirmed>reviewLimit)return;
    if(confirmed===0){void discardEmptyFocus(active.id);return;}
    void focusRequest(null,`/api/sessions/${active.id}/finish`,{confirmed_seconds:confirmed},
      ()=>{setFinishReview(false);setFocusClock(null);notify({kind:'success',title:'Focus session saved',detail:`${duration(confirmed)} recorded.`});});
  };
  const loadDriveStatus=useCallback(async()=>{
    if (useFirebase&&!user) return;
    try {setDrive(await api<DriveStatus>('/api/drive/status',user));}catch{/* noncritical */}
  },[user]);
  useEffect(()=>{if(authReady)void loadDriveStatus();},[authReady,loadDriveStatus]);
  const loadIndex=useCallback(async()=>{
    try {
      const result=await api<DriveIndexResponse>('/api/drive/index',user);
      setSourceFolder(result.folder);setDriveIndex(result.files);
    }catch(e){setError(e instanceof Error?e.message:'Cannot read Goodnotes index');}
  },[user]);
  useEffect(()=>{if(authReady&&drive.connected)void loadIndex();},[authReady,drive.connected,loadIndex]);
  const browseDrive=useCallback(async(folderId:string,more=false,token?:string)=>{
    setDriveBusy(true);setError('');
    try {const result=await api<DriveList>(`/api/drive/files?folder_id=${encodeURIComponent(folderId)}${token?`&page_token=${encodeURIComponent(token)}`:''}`,user);
      setDriveFiles(existing=>more?[...existing,...result.files]:result.files);setDriveNext(result.nextPageToken||null);
    }catch(e){setError(e instanceof Error?e.message:'Drive browsing failed');}
    finally{setDriveBusy(false);}
  },[user]);
  const openFolder=(folder:DriveEntry)=>{setFolderPath(p=>[...p,{id:folder.id,name:folder.name}]);void browseDrive(folder.id);};
  const backFolder=()=>{if(folderPath.length===1)return;const next=folderPath.slice(0,-1);setFolderPath(next);void browseDrive(next.at(-1)!.id);};
  const connectDrive=()=>void act(async()=>{const result=await api<{authorization_url:string}>('/api/drive/connect',user);window.location.assign(result.authorization_url);},{collection:'none'});
  // Opening a document is a read, not a mutation. Show feedback immediately, and
  // keep it independent of the global save lock. Only the newest request can win.
  const previewPdf=(fileId:string,title:string,resourceId?:string,lastPage=1)=>{
    // Avoid unnecessary repeated downloads when the identical file is loading.
    if(pdfPendingFileRef.current===fileId)return;
    pdfPendingFileRef.current=fileId;
    const {requestId,controller}=pdfRequestGateRef.current.begin();
    if(pdfObjectUrlRef.current){URL.revokeObjectURL(pdfObjectUrlRef.current);pdfObjectUrlRef.current=null;}
    if(pdf)flushPdfBookmark();
    setPdf(null);
    const page=Math.max(1,Math.floor(lastPage)||1);
    setPdfOpening({requestId,fileId,title,resourceId,page,status:'loading'});
    void (async()=>{
      let timedOut=false;
      const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},PDF_FETCH_TIMEOUT_MS);
      try{
        const url=await pdfBlob(`/api/drive/files/${encodeURIComponent(fileId)}/pdf`,user,controller.signal);
        // Cancellation can race with blob creation: revoke any unused object URL.
        if(controller.signal.aborted||!pdfRequestGateRef.current.isCurrent(requestId)){URL.revokeObjectURL(url);return;}
        const resource=data.resources.find(entry=>entry.id===resourceId);
        pdfObjectUrlRef.current=url;
        setPdf({url,title,resourceId,courseId:resource?.course_id,weekNumber:resource?.week_number??weekNumber,page});
        setPdfOpening(null);
      }catch(e){
        if(!pdfRequestGateRef.current.isCurrent(requestId))return;
        const cancelled=controller.signal.aborted&&!timedOut;
        if(cancelled)return;
        const message=timedOut?'The PDF took too long to download. Try again, or open it from Google Drive.':
          e instanceof Error?e.message:'Could not open this PDF.';
        setPdfOpening({requestId,fileId,title,resourceId,page,status:'error',message});
      }finally{
        window.clearTimeout(timeout);
        if(pdfRequestGateRef.current.isCurrent(requestId))pdfPendingFileRef.current=null;
        pdfRequestGateRef.current.release(requestId,controller);
      }
    })();
  };
  const flushPdfBookmark=useCallback(()=>{
    if(pdfBookmarkTimerRef.current){clearTimeout(pdfBookmarkTimerRef.current);pdfBookmarkTimerRef.current=null;}
    const latest=pdfBookmarkPendingRef.current;
    pdfBookmarkPendingRef.current=null;
    if(!latest)return;
    // Serialize bookmark writes so a slow previous page cannot overwrite a newer page.
    pdfBookmarkWriteRef.current=pdfBookmarkWriteRef.current.catch(()=>{}).then(async()=>{
      try{await api(`/api/resources/${latest.id}/reading-position`,user,{method:'PATCH',body:{page:latest.page}});}
      catch(e){setError(`Page bookmark could not be saved. ${e instanceof Error?e.message:''}`);}
    });
  },[user]);
  const closePdf=()=>{
    pdfRequestGateRef.current.cancel();pdfPendingFileRef.current=null;
    setPdfOpening(null);
    flushPdfBookmark();
    if(pdfObjectUrlRef.current)URL.revokeObjectURL(pdfObjectUrlRef.current);
    pdfObjectUrlRef.current=null;setPdf(null);
  };
  // Prevent old requests and blob URLs surviving page unmount.
  useEffect(()=>()=>{
    pdfRequestGateRef.current.cancel();pdfPendingFileRef.current=null;
    if(pdfObjectUrlRef.current)URL.revokeObjectURL(pdfObjectUrlRef.current);
  },[]);
  const openTaskResource=(item:Item)=>{
    const r=data.resources.find(entry=>entry.id===item.resource_id);
    if(!r){setError('The linked document is no longer available. Check the Course Library.');return;}
    if(r.source==='drive'&&r.drive_file_id)previewPdf(r.drive_file_id,r.title,r.id,r.last_page);
    else if(r.url)window.open(r.url,'_blank','noopener,noreferrer');
  };

  useEffect(()=>{
    const saveWhenHidden=()=>{if(document.visibilityState==='hidden'&&pdfBookmarkPendingRef.current)flushPdfBookmark();};
    document.addEventListener('visibilitychange',saveWhenHidden);
    return ()=>document.removeEventListener('visibilitychange',saveWhenHidden);
  },[flushPdfBookmark]);
  const changePdfPage=(next:number)=>{
    if (!pdf) return;
    const page=Math.max(1,Math.min(20000,Math.floor(next)||1));
    setPdf(p=>p?{...p,page}:p);
    if (pdf.resourceId) {
      const id=pdf.resourceId;
      setData(previous=>({...previous,resources:previous.resources.map(r=>r.id===id?{...r,last_page:page}:r)}));
      pdfBookmarkPendingRef.current={id,page};
      if(pdfBookmarkTimerRef.current)clearTimeout(pdfBookmarkTimerRef.current);
      pdfBookmarkTimerRef.current=setTimeout(flushPdfBookmark,650);
    }
  };
  const linkDriveFile=(file:DriveEntry)=>{
    if(mutationBusyRef.current||selectedPdfId!==file.id||recentlyLinkedIds.has(file.id))return;
    setLinkingFileId(file.id);
    void act(async()=>{
    if(!linkCourse)throw new Error('Select a course before linking a PDF');
    const saved=await api<Resource>('/api/resources',user,{method:'POST',body:{course_id:linkCourse,week_number:linkScope==='course'?null:linkWeek,title:file.name,kind:linkKind,source:'drive',drive_file_id:file.id,item_id:linkScope==='course'?null:(linkItem||null)}});
    // Reindex in the background; the returned resource updates the course immediately.
    setRecentlyLinkedIds(previous=>new Set(previous).add(file.id));
    void loadIndex();
    return saved;
    },{collection:'resources'},{title:'PDF linked',detail:`${file.name} added to your course.`}).finally(()=>setLinkingFileId(null));
  };
  const selectBackupFolder=()=>void act(async()=>{
    if(currentFolder.id==='root')throw new Error('Choose the Goodnotes backup folder, not the root of your Drive');
    const result=await api<{folder:DriveSource}>('/api/drive/source-folder',user,{method:'POST',body:{folder_id:currentFolder.id}});
    setSourceFolder(result.folder);setDriveIndex([]);setSelectedPdfId(null);setRecentlyLinkedIds(new Set());
  },{collection:'none'},{title:'Backup folder selected',detail:'Ready to scan Goodnotes PDFs.'});
  const scanBackup=async()=>{
    if(scanBusyRef.current)return;
    scanBusyRef.current=true;setScanBusy(true);setError('');
    try {
      const result=await api<DriveScanResponse>('/api/drive/scan',user,{method:'POST'});
      setDriveIndex(result.files);setRecentlyLinkedIds(new Set(result.files.filter(file=>file.links.length>0).map(file=>file.id)));
      setSourceFolder(f=>f?{...f,scanned_at:result.scanned_at}:f);
      setVisibleCount(30);
      notify({kind:'success',title:'Drive scan completed',detail:`${result.count} PDFs indexed.`});
    }catch(e){notify({kind:'error',title:'Drive scan failed',detail:e instanceof Error?e.message:'Try again.',action:{label:'Retry scan',onClick:()=>{void scanBackup();}}});}
    finally{scanBusyRef.current=false;setScanBusy(false);}
  };
  const selectedIndexed=driveIndex.find(f=>f.id===selectedPdfId);
  const selectedBrowsePdf=driveFiles.find(f=>f.id===selectedPdfId&&f.mimeType==='application/pdf');
  const selectedPdf=selectedIndexed??selectedBrowsePdf;
  const choosePdf=(entry:DriveEntry|DriveIndexed)=>{
    // Never carry course/week selections from a different file into a new link.
    setSelectedPdfId(entry.id);
    const suggestion='suggestion' in entry ? entry.suggestion : null;
    const intended=linkIntentRef.current;
    setLinkCourse(suggestion?.course_id||intended?.courseId||'');
    setLinkWeek(suggestion?.week_number||intended?.week||1);
    setLinkScope(suggestion?( ['textbook','handwritten'].includes(suggestion.kind)?'course':'week'):(intended?.scope||'week'));
    setLinkKind(suggestion?.kind||intended?.kind||'handwritten');
    setLinkItem('');
    if(window.innerWidth<=900){window.requestAnimationFrame(()=>linkPanelRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));}
  };
  const indexedVisible=filterIndexedPdfs(driveIndex,indexFilter,indexSearch);
  const currentFolder=folderPath.at(-1)!;
  useEffect(()=>{if(tab==='library'&&drive.connected&&driveFiles.length===0)void browseDrive(currentFolder.id);},[tab,drive.connected]); // initial browse only

  if (useFirebase&&!authReady) return <div className="boot"><LoaderCircle className="spin"/><p>Checking sign-in…</p></div>;
  if (useFirebase&&!user) return <main className="login-shell"><Card className="login-card"><span className="brand-mark"><GraduationCap/></span><h1>Study Hub</h1><p>Sign in to continue.</p><button className="btn primary" onClick={()=>void signIn()}>Sign in with Google</button></Card></main>;

  return <div className={`app-shell ${theme==='dark'?'theme-dark':''}${sidebarResizing?' sidebar-is-resizing':''}`}>
    <FeedbackToasts messages={feedbackMessages} dismiss={dismissFeedback}/>
    <aside className={'sidebar'+(sidebarCollapsed?' is-collapsed':'')} style={sidebarWidth===null?undefined:{'--sidebar-user-width':`${sidebarWidth}px`} as CSSProperties}>
      <div className="sidebar-header">
        <div className="brand"><span className="brand-mark"><BookOpen size={21}/></span><div className="sidebar-brand-copy"><strong>Study Hub</strong><small>DTU</small></div></div>
        <button type="button" className="sidebar-collapse-button" aria-label={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} title={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={toggleSidebar}>{sidebarCollapsed?<PanelLeftOpen size={19}/>:<PanelLeftClose size={19}/>}</button>
      </div>
      <div className="nav-label">MY WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{tabs.map(t=><button key={t.id} type="button" title={sidebarCollapsed?t.label:undefined} aria-label={t.id==='tasks'&&openTasks.length>0?`${t.label}, ${openTasks.length} incomplete tasks`:t.label} onClick={()=>navigate(t.id)} className={'nav-btn '+(tab===t.id?'current':'')} aria-current={tab===t.id?"page":undefined}><t.icon size={18}/><span className="nav-text">{t.label}</span>{t.id==='tasks'&&openTasks.length>0&&<span className="nav-count" title={`${openTasks.length} incomplete tasks`} aria-hidden="true">{openTasks.length}</span>}</button>)}</nav>
      <div className="sidebar-spacer"/>
      <div className="sidebar-bottom">
        <div className="sidebar-profile">
          <span className="sidebar-profile-avatar" aria-hidden="true">{profileInitials}</span>
          <ProfileName name={profileName}/>
        </div>
        <div className="sidebar-footer-row">
          <span className="sidebar-account"><span className="live-dot" aria-hidden="true"/>{useFirebase?'Private workspace':'Local development'}</span>
          {useFirebase&&<button type="button" className="sidebar-signout" title="Sign out" aria-label="Sign out of Study Hub" onClick={()=>void signOutUser()}><LogOut size={15}/><span className="sidebar-signout-label">Sign out</span></button>}
        </div>
      </div>
      {!sidebarCollapsed&&<div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={205} aria-valuemax={340} aria-valuenow={sidebarWidth??252} aria-valuetext={sidebarWidth===null?"Default width":`${sidebarWidth} pixels`} tabIndex={0} title="Drag to resize sidebar · double-click to reset" onPointerDown={onSidebarPointerDown} onPointerMove={onSidebarPointerMove} onPointerUp={onSidebarPointerEnd} onPointerCancel={onSidebarPointerEnd} onLostPointerCapture={()=>{sidebarDragRef.current=null;setSidebarResizing(false);}} onKeyDown={onSidebarResizeKey} onDoubleClick={()=>saveSidebarWidth(null)}/>}
    </aside>
    <div className="main-area">
      <header className={'topbar'+(tab==='today'?' dashboard-topbar':'')}><div className="mobile-topbar-brand"><BookOpen size={19} aria-hidden="true"/><span>Study Hub</span></div><div className="breadcrumb"><Sparkles size={16} aria-hidden="true"/> STUDY HUB <span>/</span> <strong>{pageNames[tab]}</strong></div><div className="topbar-right">
          <span className="topbar-datetime"><span className="topbar-date-section"><CalendarDays size={15} aria-hidden="true"/>{dateLabel}</span><span className="topbar-datetime-divider" aria-hidden="true"/><span title="Your local time (24-hour clock)" aria-label={`Local time ${timeLabel}`}><Clock3 size={15} aria-hidden="true"/><time dateTime={clockReady?new Date(now*1000).toISOString():undefined}>{timeLabel}</time></span></span>
          <div className="topbar-focus-wrap" ref={quickFocusRef}>
            {active?<>
              <button type="button" className="topbar-focus-session" aria-expanded={quickFocusOpen} aria-controls="active-focus-menu" onClick={()=>setQuickFocusOpen(value=>!value)} title="Manage focus session" aria-label={`${active.status==='paused'?'Paused':'Running'} focus session; manage session`}>
                <span className={'topbar-focus-dot'+(active.status==='paused'?' paused':'')}/>
                <span>{active.status==='paused'?'Paused':'Focus'} · <FocusElapsed session={active} anchor={focusClock}/></span>
                <ChevronDown size={15} aria-hidden="true"/>
              </button>
              {quickFocusOpen&&<div id="active-focus-menu" className="active-focus-menu" role="group" aria-label="Focus session controls">
                <button type="button" disabled={focusBusy} onClick={()=>{setQuickFocusOpen(false);sessionAction(active.status==='running'?'pause':'resume');}}>
                  {active.status==='running'?<Pause size={16}/>:<Play size={16}/>} {active.status==='running'?'Pause session':'Resume session'}
                </button>
                <button type="button" disabled={focusBusy} onClick={()=>{setQuickFocusOpen(false);reviewFinish();}}><Square size={15}/> End session</button>
              </div>}
            </>:<>
              <button type="button" className="topbar-quick-focus" aria-expanded={quickFocusOpen} aria-controls="quick-focus-menu" onClick={()=>setQuickFocusOpen(value=>!value)} disabled={busy||focusBusy||!snapshotReady}>
                <Timer size={16}/> Quick focus <ChevronDown size={14}/>
              </button>
              {quickFocusOpen&&<div className="quick-focus-menu" id="quick-focus-menu" role="group" aria-label="Quick focus setup">
                <div className="quick-focus-menu-heading"><Timer size={17}/><strong>Start a focus session</strong></div>
                <label>Focus duration
                  <select value={quickFocusMode} onChange={e=>setQuickFocusMode(e.target.value as typeof quickFocusMode)}>
                    <option value="25">Pomodoro · 25 min</option><option value="50">Focus · 50 min</option><option value="90">Deep work · 90 min</option><option value="free">Stopwatch</option>
                  </select>
                </label>
                <label>Course (optional)
                  <select value={quickFocusCourse} onChange={e=>{setQuickFocusCourse(e.target.value);setQuickFocusItem('');}}>
                    <option value="">Personal / general</option>
                    {data.courses.filter(c=>!c.archived).map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
                  </select>
                </label>
                <label>Task (optional)
                  <select value={quickFocusItem} onChange={e=>setQuickFocusItem(e.target.value)}>
                    <option value="">No linked task</option>
                    {focusTasksForContext(data.items,quickFocusCourse).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                </label>
                <button type="button" className="btn primary quick-focus-start" disabled={busy||focusBusy} onClick={()=>void startQuickFocus()}><Play size={15}/> Start focus</button>
                <p>Timed sessions end manually.</p>
              </div>}
            </>}
          </div>
          <button className="topbar-theme" disabled={loading||refreshing||busy} aria-label="Refresh study data" title="Refresh study data" onClick={()=>void load()}>{loading||refreshing?<LoaderCircle size={17} className="spin"/>:<RotateCcw size={17}/>}</button>
          <button className="topbar-theme" aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'} title={theme==='light'?'Dark theme':'Light theme'} onClick={toggleTheme}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button>
        </div></header>
      <main className={'page-content'+(tab==='today'?' dashboard-page':'')}>
        {error&&<div className="alert" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><X size={17}/></button></div>}
        {(loading||(!snapshotIssue&&(!snapshotReady||loadedUserRef.current!==(user?.uid||'local'))))?<div className="loading-state" role="status"><LoaderCircle className="spin"/> Securely loading your workspace…</div>:!snapshotReady?<Card className="load-error" >
          <div className="load-error-icon"><AlertTriangle size={24}/></div>
          <span className="eyebrow">WORKSPACE UNAVAILABLE</span>
          <h2>{snapshotIssue?.title||'Could not load your Study Hub'}</h2>
          <p className="muted">{snapshotIssue?.description||'Your data has not loaded. Retrying is safe; your existing records will not be deleted.'}</p>
          <div className="load-error-actions"><button className="btn primary" onClick={()=>void load()}><RotateCcw size={16}/> Retry loading</button>{useFirebase&&<button className="btn secondary" onClick={()=>void signOutUser()}>Sign out</button>}</div>
          {snapshotIssue&&<details className="load-diagnostics"><summary>Technical details for troubleshooting</summary><code>{snapshotIssue.diagnostics}</code></details>}
        </Card>:<>
          {tab==='today'&&<div className="dashboard-home">
            <div className="dashboard-intro">
              <span className="eyebrow"><Sparkles size={14}/> YOUR STUDY HUB</span>
              <h1>{hello}{firstName?`, ${firstName}`:''} <span aria-hidden="true">👋</span></h1>
            </div>
            <div className="home-layout">
              <div className="home-main-column">
                <div className="home-stats-grid" aria-label="Study overview">
                  <div className="home-stat"><span className="home-stat-icon purple"><ListTodo size={23}/></span><strong>{todayWork.length}</strong><span>Tasks today</span></div>
                  <div className={'home-stat'+(overdue.length?' danger':'')}><span className={"home-stat-icon "+(overdue.length?"red":"purple")}><AlertTriangle size={23}/></span><strong>{overdue.length}</strong><span>Overdue</span></div>
                  <div className="home-stat"><span className="home-stat-icon purple"><CalendarDays size={23}/></span><strong>{upcoming.length}</strong><span>Upcoming deadlines</span></div>
                  <div className="home-stat"><span className="home-stat-icon blue"><BarChart3 size={23}/></span><strong><ProgressValue value={weekSeconds/3600} decimals={1} suffix=" h"/></strong><span>Focus this week</span></div>
                </div>
                <section className="home-panel home-course-panel" aria-labelledby="home-courses-title">
                  <div className="home-panel-heading"><div className="home-heading-icon"><BookOpen size={21}/></div><div><h2 id="home-courses-title">Today’s study courses</h2></div><span className="home-count-pill">{studyGroups.length} {studyGroups.length===1?'course':'courses'}</span></div>
                  {studyGroups.length?<>
                    <div className={`home-course-grid course-count-${Math.min(studyGroups.length,3)}`} ref={courseScrollerRef} onScroll={syncCourseScroll} role="region" aria-label="Today’s study course cards" tabIndex={0}>
                      {studyGroups.map((group,index)=>{
                        const weekLabel=group.weekNumbers.length===1?`Week ${group.weekNumbers[0]}`:group.weekNumbers.length?`Weeks ${group.weekNumbers.join(', ')}`:'Course tasks';
                        const doneCount=visibleCourseDoneCount(group.doneCount,group.activityCount,group.tasks,completingIds,completedItemIds);
                        const progress=group.activityCount?Math.round(100*doneCount/group.activityCount):0;
                        const todayCount=group.todayCount;
                        const primaryWeek=group.weekNumbers.length===1?group.weekNumbers[0]:null;
                        const weekTopic=primaryWeek!=null?data.weeks.find(w=>w.course_id===group.course.id&&w.number===primaryWeek)?.title:null;
                        return <div key={group.course.id} className={'home-course-tile tile-'+(index%4)}>
                          <div className="home-course-heading"><div className="home-course-icon"><BookOpen size={24}/></div><div className="home-course-title"><h3>{group.course.code} · {group.course.title}</h3><span>{weekLabel}</span></div>{group.overdueCount>0&&<span className="home-overdue-pill">{group.overdueCount} overdue</span>}</div>
                          <div className="home-course-overview">
                            {weekTopic&&<p className="home-course-topic" title={weekTopic}>{weekTopic}</p>}
                            <span className="home-course-workload">{todayCount>0?`${todayCount} ${todayCount===1?'activity':'activities'} today`:`${group.tasks.length} ${group.tasks.length===1?'activity':'activities'} to catch up on`}</span>
                          </div>
                          <div className="home-course-progress"><span>{todayCount>0?"Today’s progress":"Catch-up progress"} · {doneCount}/{group.activityCount} complete · <ProgressValue value={progress}/></span><ProgressTrack className="home-progress-track" identity={group.course.id} label={`${group.course.title} ${todayCount>0?"today’s":"catch-up"} activity progress`} value={progress}/></div>
                          <div className="home-course-actions"><button className="home-open-course" onClick={()=>openCourse(group.course.id)}>Open course <ArrowRight size={16}/></button><CourseActionsMenu courseId={group.course.id} courseTitle={group.course.title} onViewTasks={()=>openCourse(group.course.id,undefined,undefined,'tasks')} onFocus={()=>focusOnCourse(group.course.id)} onLibrary={()=>openCourse(group.course.id,undefined,undefined,'course-library')}/></div>
                        </div>;
                      })}
                    </div>
                    {studyGroups.length>3&&<div className="home-course-pagination" aria-label="Browse courses"><span>{Math.min(courseScrollIndex+1,studyGroups.length)}–{Math.min(courseScrollIndex+visibleCourseCards,studyGroups.length)} of {studyGroups.length} courses</span><div><button type="button" aria-label="Previous course cards" onClick={()=>scrollCourses(-1)} disabled={courseScrollIndex===0}><ArrowLeft size={16}/></button><button type="button" aria-label="Next course cards" onClick={()=>scrollCourses(1)} disabled={!canScrollNextCourse}><ArrowRight size={16}/></button></div></div>}
                  </>:<PhotoEmptyState compact scene="home" title="Your day is clear" detail={selectedCourse?'No course work scheduled today. Plan a new activity when you’re ready.':'No study tasks planned for today.'} actionLabel="Add task" onAction={()=>{setTaskForm(true);setTab('tasks');}} secondaryLabel="Open calendar" onSecondary={()=>openCalendarDate(today)}/>}
                </section>
                <section className="home-panel home-priorities" aria-labelledby="home-priorities-title">
                  <div className="home-panel-heading"><div className="home-heading-icon"><CheckCircle2 size={21}/></div><div><h2 id="home-priorities-title">Today’s priorities</h2></div><div className="home-priority-filters" aria-label="Filter priorities">{(['all','course','personal'] as const).map(filter=><button key={filter} onClick={()=>setPriorityFilter(filter)} className={priorityFilter===filter?'active':''} aria-pressed={priorityFilter===filter}>{filter==='all'?'All':filter==='course'?'Course':'Personal'}</button>)}</div></div>
                  {filteredPriorities.length?<div className="home-priority-list">{filteredPriorities.slice(0,6).map(i=><div key={i.id} className={'home-priority-row task-completion-row'+(isOverdue(i,today)?' overdue':'')+(completingIds.has(i.id)?' is-completing':'')+(exitingIds.has(i.id)?' is-exiting':'')}><input type="checkbox" aria-label={`Complete ${i.title}`} disabled={busy||pendingItems.has(i.id)||completingIds.has(i.id)} className="task-completion-check" checked={i.done||completingIds.has(i.id)} onChange={()=>toggle(i)}/><button type="button" className="home-priority-info" aria-label={`Open ${i.title}`} onClick={()=>openDeadlineDestination(i)}><strong>{i.title}</strong><small>{i.course_id?(data.courses.find(c=>c.id===i.course_id)?.code||'Course'):'Personal'}{i.week_number?` · Week ${i.week_number}`:''}{activityReference(i)?` · ${activityReference(i)}`:''}{i.due_date&&i.due_date<today?` · Due ${dateText(i.due_date)}`:i.planned_date&&i.planned_date<today?` · Planned ${dateText(i.planned_date)}`:''}</small></button>{isOverdue(i,today)&&<span className="home-priority-tag overdue">Overdue</span>}{i.resource_id&&<button className="home-row-action" aria-label={`Open resource for ${i.title}`} disabled={busy} onClick={()=>openTaskResource(i)} title="Open linked resource"><BookOpen size={16}/></button>}<button className="home-row-action" aria-label={`Focus on ${i.title}`} disabled={busy} onClick={()=>startFrom(i)} title="Focus on task"><Play size={15}/></button></div>)}</div>:studyGroups.length&&priorityFilter==='all'?<PhotoEmptyState compact scene="home" title="All caught up" detail="No priorities scheduled for today." actionLabel="Add task" onAction={()=>{setTaskForm(true);setTab('tasks');}}/>:<div className="home-list-empty"><CheckCircle2 size={19}/> {priorityFilter==='all'?'No priorities for today.':`No ${priorityFilter} priorities for today.`}</div>}
                  {filteredPriorities.length>6&&<button className="home-panel-link home-list-footer" onClick={()=>navigate('tasks')}>View {filteredPriorities.length-6} more tasks <ArrowRight size={14}/></button>}
                </section>
              </div>
              <div className="home-side-column">
                {upcoming.length>0&&<section className="home-panel home-deadlines" aria-labelledby="home-deadlines-title"><div className="home-widget-heading"><span className="home-heading-icon"><CalendarDays size={20}/></span><h2 id="home-deadlines-title">Upcoming deadlines</h2><button className="home-panel-link" onClick={showUpcomingTasks}>View all <ArrowRight size={14}/></button></div>{upcoming.slice(0,3).map(i=><button className="home-deadline" key={i.id} onClick={()=>openDeadlineDestination(i)}><span className="home-deadline-date"><strong>{i.due_date!.slice(8,10)}</strong>{new Intl.DateTimeFormat('en-GB',{month:'short'}).format(new Date(i.due_date!+'T12:00:00'))}</span><span className="home-deadline-info"><strong>{i.title}</strong><small>{data.courses.find(c=>c.id===i.course_id)?.code||'Personal'}{i.week_number?` · Week ${i.week_number}`:''}</small></span><span className="home-days-away">{nextDeadlineDays(today,i.due_date!)===0?'Today':`${nextDeadlineDays(today,i.due_date!)}d`}</span></button>)}</section>}
                <section className="home-panel home-week-strip" aria-labelledby="home-calendar-title"><div className="home-widget-heading"><span className="home-heading-icon"><CalendarDays size={20}/></span><h2 id="home-calendar-title">Next 7 days</h2><button className="home-panel-link" onClick={()=>openCalendarDate(homeSelectedDate||today)}>Full calendar <ArrowRight size={14}/></button></div><div className="home-day-grid">{calendarDays.map((day,index)=><button key={day.date} className={'home-day'+(index===0?' current':'')+(homeSelectedDate===day.date?' selected':'')} aria-label={`Show ${day.weekday} ${day.day} tasks inline${day.count?`, ${day.count} scheduled items`:''}`} aria-pressed={homeSelectedDate===day.date} aria-controls={homeSelectedDate?'home-day-agenda':undefined} title={`${day.count} planned/due items`} onClick={()=>toggleHomeAgenda(day.date)}><span>{day.weekday}</span><strong>{day.day}</strong><span className={'home-day-dot'+(day.count?' has-work':'')}/></button>)}</div>{homeSelectedDate&&<div id="home-day-agenda" className="home-inline-agenda"><div className="home-inline-agenda-header"><div><strong>{new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'short'}).format(new Date(homeSelectedDate+'T12:00:00'))}</strong><span>{homeAgenda.length} {homeAgenda.length===1?'item':'items'}</span></div><button type="button" aria-label="Close day details" className="home-agenda-close" onClick={()=>setHomeSelectedDate(null)}><X size={16}/></button></div>{homeAgenda.length?<div className="home-inline-agenda-list">{homeAgenda.slice(0,5).map(({item,reason})=><div className={'home-inline-agenda-item task-completion-row'+(completingIds.has(item.id)?' is-completing':'')+(exitingIds.has(item.id)?' is-exiting':'')} key={item.id}><input type="checkbox" checked={item.done||completingIds.has(item.id)} disabled={busy||pendingItems.has(item.id)||completingIds.has(item.id)} className="task-completion-check" aria-label={`Complete ${item.title}`} onChange={()=>toggle(item)}/><button type="button" className="home-agenda-item-main" onClick={()=>openDeadlineDestination(item)}><strong>{item.title}</strong><small>{data.courses.find(c=>c.id===item.course_id)?.code||'Personal'}{item.week_number?` · Week ${item.week_number}`:''} · {reason==='planned-and-due'?'Planned & due':reason==='planned'?'Planned':'Due'}</small></button><ArrowRight size={15} aria-hidden="true"/></div>)}{homeAgenda.length>5&&<p className="home-agenda-more">+{homeAgenda.length-5} additional items</p>}</div>:<p className="home-side-empty">No tasks planned or due on this day.</p>}<button type="button" className="home-panel-link home-agenda-full" onClick={()=>openCalendarDate(homeSelectedDate)}>Open full day <ArrowRight size={14}/></button></div>}</section>
              </div>
            </div>
          </div>}

          {tab==='courses'&&<CoursePlanner data={data.items===presentedItems?data:{...data,items:presentedItems}} progressItems={data.items} user={user} busy={busy} pendingItems={pendingItems} completingIds={completingIds} exitingIds={exitingIds}
            courseId={courseId} weekNumber={weekNumber} landingItem={courseLandingItem} sectionJump={courseSectionJump} selectCourse={rememberCourse} selectWeek={rememberWeek}
            run={act} toggleItem={toggle} focusOn={startFrom}
            openResource={r=>{if(r.source==='drive'&&r.drive_file_id)previewPdf(r.drive_file_id,r.title,r.id,r.last_page);else if(r.url)window.open(r.url,'_blank','noopener,noreferrer');}}
            openDrive={(id,week,kind,scope)=>{linkIntentRef.current={courseId:id,week,kind,scope};setSelectedPdfId(null);setLinkCourse(id);setLinkWeek(week);setLinkScope(scope);setLinkKind(kind);setLinkItem('');setTab('library');}}
          />}

          {tab==='tasks'&&<TasksPlanner items={tasks} courses={data.courses} user={user} busy={busy} pendingItems={pendingItems} completingIds={completingIds} exitingIds={exitingIds}
            run={act} onToggle={toggle} onFocus={startFrom} onOpenResource={openTaskResource} createOpen={taskForm} setCreateOpen={setTaskForm}
            initialTaskMode={taskLandingMode} taskJump={taskJump} onTaskJumpHandled={()=>setTaskJump(null)}/>}

          {tab==='calendar'&&<TasksPlanner items={tasks} courses={data.courses} user={user} busy={busy} pendingItems={pendingItems} completingIds={completingIds} exitingIds={exitingIds}
            run={act} onToggle={toggle} onFocus={startFrom} onOpenResource={openTaskResource} createOpen={taskForm} setCreateOpen={setTaskForm}
            calendarOnly calendarJump={calendarJump}/>}

          {tab==='focus'&&<>
            <div className="page-heading"><div><span className="eyebrow"><Target size={13}/> DEEP WORK</span><h1>Find your flow.</h1><p>Settle into a distraction-free session. Every minute counts.</p></div></div>
            <div className="focus-layout"><Card className="focus-card">
              {!active&&<div className="focus-settings">
                <FormRow label="Course (optional)"><select value={focusCourse} onChange={e=>{setFocusCourse(e.target.value);setFocusItem('');}}><option value="">General / personal</option>{data.courses.filter(c=>!c.archived).map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></FormRow>
                <FormRow label="Focus task (optional)"><select value={focusItem} onChange={e=>setFocusItem(e.target.value)}><option value="">No linked task</option>{focusTasksForContext(data.items,focusCourse).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></FormRow>
              </div>}
              {active&&<div className="focus-context">
                <Badge tone={active.status==='paused'?'warning':'good'}>{active.status==='paused'?'Paused':'Focusing'}</Badge>
                <strong>{data.items.find(i=>i.id===active.item_id)?.title||data.courses.find(c=>c.id===active.course_id)?.title||'General focus'}</strong>
              </div>}
              {active?<div className="focus-target-summary">{active.mode==='free'?'Stopwatch session':`${active.mode}-minute target`}</div>
                :<div className="focus-modes">{(['25','50','90','free'] as const).map(m=><button key={m} className={focusMode===m?'current':''} onClick={()=>setFocusMode(m)}>{m==='free'?'Stopwatch':`${m} min`}</button>)}</div>}
              {active?<FocusDial session={active} anchor={focusClock}/>:<div className="timer-dial"><span className="dial-label">{focusMode==='free'?'STOPWATCH':'FOCUS TARGET'}</span><strong>{focusMode==='free'?'00:00:00':duration(Number(focusMode)*60)}</strong><span className="dial-sub">Ready when you are</span></div>}
              {active?<div className="focus-buttons"><button className="btn secondary" onClick={()=>sessionAction(active.status==='running'?'pause':'resume')} disabled={focusBusy}>{active.status==='running'?<Pause size={17}/>:<Play size={17}/>} {active.status==='running'?'Pause':'Resume'}</button><button className="btn primary" disabled={focusBusy} onClick={reviewFinish}><Square size={15}/> Finish & review</button></div>
                :<button className="btn primary focus-start" disabled={busy||focusBusy} onClick={beginFocus}><Play size={18}/> Start focusing</button>}
              <p className="focus-tip">{active?.status==='paused'?'Paused time is excluded from your focus total.':active?'Keep this session open or return when you are ready to review it.':'Timed sessions end manually. Pause or review a session whenever you need.'}</p>
            </Card><div className="stack">
              <Card><SectionTitle title="Your focus statistics"/>
                <div className="focus-stat"><span>This week</span><strong>{formatFocusDuration(weekSeconds)}</strong></div>
                <div className="focus-stat"><span>All time</span><strong>{formatFocusDuration(totalSeconds)}</strong></div>
                <div className="focus-stat"><span>Completed sessions</span><strong>{data.focus_stats?.completed_sessions ?? data.sessions.filter(s=>s.status==='finished'&&(s.focus_seconds||0)>0).length}</strong></div>
              </Card>
              <Card className="focus-week-goal"><SectionTitle title="Weekly focus goal" aside={<div className="focus-goal-aside"><span>{formatFocusDuration(weekSeconds)} / {weeklyGoal}h</span><button className="icon-btn" type="button" aria-label={editingFocusGoal?'Done editing weekly goal':'Edit weekly focus goal'} aria-expanded={editingFocusGoal} onClick={()=>setEditingFocusGoal(v=>!v)}>{editingFocusGoal?<Check size={16}/>:<Pencil size={16}/>}</button></div>}/>
                <ProgressTrack className="home-progress-track" label="Weekly focus goal progress" value={weekPct} identity="focus-weekly-goal"/>
                <div className="focus-week-goal-footer"><span><ProgressValue value={weekPct}/> of your weekly goal</span><span>This week</span></div>
                {editingFocusGoal&&<div className="focus-goal-editor"><label>Target <input type="number" min={1} max={80} aria-label="Weekly focus target in hours" value={weeklyGoal} onChange={e=>{const n=Math.max(1,Math.min(80,Number(e.target.value)||1));setWeeklyGoal(n);localStorage.setItem('studyhub-focus-goal',String(n));}}/> hours/week</label><small>Saved on this device.</small></div>}
              </Card>
              <Card><SectionTitle title="Recent sessions"/>
                {data.sessions.filter(s=>s.status==='finished'&&(s.focus_seconds||0)>0).sort((a,b)=>(b.ended_at||0)-(a.ended_at||0)).slice(0,5).map(s=><div className="session-row" key={s.id}>
                  <span><Check size={15}/></span><div className="session-main"><strong>{data.items.find(i=>i.id===s.item_id)?.title||'Focus session'}</strong><small>{data.courses.find(c=>c.id===s.course_id)?`${data.courses.find(c=>c.id===s.course_id)?.code} · ${data.courses.find(c=>c.id===s.course_id)?.title} · `:''}{new Date(s.started_at*1000).toLocaleDateString()}</small></div><b className="session-duration">{formatFocusDuration(s.focus_seconds||0)}</b>
                </div>)}
                {!data.sessions.some(s=>s.status==='finished'&&(s.focus_seconds||0)>0)&&<p className="muted">Your finished sessions will appear here.</p>}
              </Card>
            </div></div>
          </>}

          {tab==='library'&&<>
            <div className="page-heading"><div><span className="eyebrow"><Folder size={13}/> CONNECTED MATERIALS</span><h1>Resources</h1><p>Find Goodnotes PDFs and link them to your coursework.</p></div></div>
            <div className="resources-layout">
              <div className="stack resources-list-column">
                {!drive.connected&&data.resources.length===0&&<PhotoEmptyState compact scene="resources" title="No resources yet" detail="Link slides, books, and notes from your courses." actionLabel="Open Study" onAction={()=>navigate('courses')}/>}
                <Card className="resources-source-card">
                  <div className="resources-source-header"><div><strong><Cloud size={17}/> Google Drive source</strong><small>{sourceFolder?`Goodnotes backup · ${sourceFolder.name}`:'Choose your Goodnotes backup folder'}</small></div>
                    <Badge tone={drive.connected?'good':'muted'}>{drive.connected?'Connected':'Not connected'}</Badge>
                  </div>
                  {drive.connected?<>
                    <div className="resources-source-actions"><span className="resources-index-count"><FileText size={14}/> {driveIndex.length} indexed PDFs · {driveIndex.filter(f=>f.links.length>0).length} linked</span>
                      <button className="btn secondary small" type="button" onClick={()=>setFoldersExpanded(v=>!v)} aria-expanded={foldersExpanded}>{foldersExpanded?'Hide Drive folders':'Change / browse folder'}</button>
                      {sourceFolder&&<button className="btn primary small" disabled={scanBusy||busy} onClick={()=>void scanBackup()}>{scanBusy?<LoaderCircle size={14} className="spin"/>:<ScanSearch size={14}/>} {scanBusy?'Scanning…':'Scan PDFs'}</button>}
                    </div>
                    <div className="resources-connection-line"><span className="live-dot"/> Connected privately <button className="text-button" onClick={()=>{if(confirm('Disconnect Google Drive and erase the local folder index? Existing linked resources will remain.'))void act(async()=>{await api('/api/drive/disconnect',user,{method:'DELETE'});setDrive({connected:false,configured:drive.configured});setDriveFiles([]);setSourceFolder(null);setDriveIndex([]);setSelectedPdfId(null);setRecentlyLinkedIds(new Set());},{collection:'none'},{title:'Google Drive disconnected',detail:'Existing linked resources are kept.'});}}>Disconnect</button></div>
                    {(foldersExpanded||!sourceFolder)&&<div className="resources-folder-browser">
                      <div className="folder-picker-heading"><strong>Browse Drive folders</strong><button className="icon-btn" title="Refresh folder" disabled={driveBusy} onClick={()=>void browseDrive(currentFolder.id)}><RotateCcw size={16}/></button></div>
                      <div className="folder-path"><button onClick={()=>{setFolderPath([{id:'root',name:'My Drive'}]);void browseDrive('root');}}>My Drive</button>{folderPath.slice(1).map(f=><span key={f.id}> / {f.name}</span>)}</div>
                      <div className="folder-picker-actions">{folderPath.length>1&&<button className="btn secondary small" onClick={backFolder}><ArrowLeft size={14}/> Back</button>}{currentFolder.id!=='root'&&<button className="btn secondary small" disabled={busy} onClick={selectBackupFolder}><FolderCheck size={14}/> Use this folder</button>}</div>
                      {driveBusy&&<p className="muted"><LoaderCircle size={15} className="spin"/> Loading Drive folders…</p>}
                      {driveFiles.map(f=><div className="drive-row" key={f.id}><span className="resource-icon">{f.mimeType==='application/pdf'?<FileText size={18}/>:<Folder size={18}/>}</span><div className="task-content"><strong title={f.name}>{f.name}</strong><small>{f.mimeType==='application/pdf'?'PDF document':'Folder'}{f.modifiedTime?' · '+new Date(f.modifiedTime).toLocaleDateString():''}</small></div>{f.mimeType==='application/pdf'?<><button className="icon-btn" title="Preview PDF" onClick={()=>previewPdf(f.id,f.name)}><BookOpen size={16}/></button><button className="btn secondary small" onClick={()=>choosePdf(f)}>Select</button></>:<button className="icon-btn" title="Open folder" onClick={()=>openFolder(f)}><ArrowRight size={17}/></button>}</div>)}
                      {!driveBusy&&driveFiles.length===0&&<p className="muted">No PDFs or subfolders here.</p>}
                      {driveNext&&<button className="btn secondary full" onClick={()=>void browseDrive(currentFolder.id,true,driveNext)}>Load more</button>}
                    </div>}
                  </>:<>
                    <p className="muted compact">Use your existing Goodnotes PDF backup. Only file names and folder paths are indexed, not copied notes.</p>
                    <button className="btn primary" disabled={!drive.configured||busy} onClick={connectDrive}><Cloud size={16}/> Connect my Drive</button>
                    {!drive.configured&&<div className="subtle-notice">First configure Google OAuth in the backend environment. The rest of Study Hub remains available.</div>}
                  </>}
                </Card>
                {drive.connected&&sourceFolder&&<Card className="resources-index-card">
                  <SectionTitle title="Discovered backup PDFs" aside={<Badge>{driveIndex.length} indexed</Badge>}/>
                  <p className="muted compact">Suggestions are based on filenames. Review each course and week before linking.</p>
                  <div className="resources-index-toolbar">
                    <label className="resources-search"><Search size={16}/><input type="search" aria-label="Search indexed PDFs" placeholder="Search filenames or folders" value={indexSearch} onChange={e=>{setIndexSearch(e.target.value);setVisibleCount(30);}}/></label>
                    <label className="resources-filter-label">Show <select aria-label="Filter indexed PDFs" value={indexFilter} onChange={e=>{setIndexFilter(e.target.value as typeof indexFilter);setVisibleCount(30);}}><option value="unlinked">Unlinked</option><option value="suggested">Suggested</option><option value="linked">Linked</option><option value="all">All files</option></select></label>
                    <button className="icon-btn" title="Refresh indexed PDFs" onClick={()=>void loadIndex()}><RotateCcw size={16}/></button>
                  </div>
                  <div className="resources-index-rows" role="region" tabIndex={0} aria-label="Discovered PDF files">
                    {indexedVisible.slice(0,visibleCount).map(f=><div className={`resources-index-row${selectedPdfId===f.id?' selected':''}`} key={f.id}>
                      <button type="button" className="resources-select-pdf" onClick={()=>choosePdf(f)} aria-pressed={selectedPdfId===f.id}>
                        <span className="resource-icon"><FileText size={18}/></span><span className="resources-file-content"><strong title={f.name}>{f.name}</strong><small title={f.path}>{f.path}{f.modifiedTime?` · Updated ${new Date(f.modifiedTime).toLocaleDateString()}`:''}</small>
                          {f.links.length>0?<span className="resources-suggestion-label">Linked</span>:f.suggestion?<span className="resources-suggestion-label"><Sparkles size={13}/> Suggested: {f.suggestion.course_code} · Week {f.suggestion.week_number} · {f.suggestion.kind}</span>:<span className="resources-suggestion-label">Needs manual matching</span>}
                        </span>
                      </button>
                      <button className="icon-btn" title={`Preview ${f.name}`} aria-label={`Preview ${f.name}`} onClick={()=>previewPdf(f.id,f.name)}><BookOpen size={16}/></button>
                    </div>)}
                  </div>
                  {indexedVisible.length===0&&(driveIndex.length===0?<PhotoEmptyState compact scene="resources" title="No backup PDFs yet" detail="Scan your Goodnotes folder to discover PDF files." actionLabel="Scan folder" onAction={()=>void scanBackup()}/>:<EmptyState icon={<FileText size={23}/>} title="No matching files" detail="Try another search or filter."/>)}
                  {indexedVisible.length>visibleCount&&<button className="btn secondary full" onClick={()=>setVisibleCount(n=>n+30)}>Show more ({indexedVisible.length-visibleCount} remaining)</button>}
                </Card>}
              </div>
              <div className={`resources-link-column${selectedPdf?'':' is-empty'}`} ref={linkPanelRef}><Card className="resources-link-card">
                <SectionTitle title="Link document"/>
                {!selectedPdf?<div className="resources-no-selection"><FileText size={25}/><strong>Select a PDF to link</strong><p>Choose a file from Discovered PDFs or the Drive folder browser. You'll review its course and week here before confirming.</p></div>:<>
                  <div className="resources-selected-file"><FileText size={18}/><div><strong title={selectedPdf.name}>{selectedPdf.name}</strong><small>Selected PDF · {selectedIndexed?.path||'Drive folder'}</small></div><button className="icon-btn" aria-label="Clear selected PDF" onClick={()=>setSelectedPdfId(null)}><X size={16}/></button></div>
                  {(selectedIndexed?.links.length||recentlyLinkedIds.has(selectedPdf.id)) ? <div className="subtle-notice">This PDF is already linked. Open it from its course library, or select another document.</div>:<>
                    {selectedIndexed?.suggestion&&<div className="resources-match-context"><Sparkles size={16}/><div><strong>Suggested: {selectedIndexed.suggestion.course_code} · Week {selectedIndexed.suggestion.week_number}</strong><small>{selectedIndexed.suggestion.confidence} confidence · Review before linking</small></div></div>}
                    <FormRow label="Course"><select value={linkCourse} onChange={e=>{setLinkCourse(e.target.value);setLinkWeek(1);setLinkItem('');}}><option value="">Select course</option>{data.courses.filter(c=>!c.archived).map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></FormRow>
                    <FormRow label="Resource belongs to"><select value={linkScope} onChange={e=>setLinkScope(e.target.value as 'course'|'week')}><option value="course">Course Library (all weeks)</option><option value="week">One teaching week</option></select></FormRow>
                    {linkScope==='week'&&<FormRow label="Week"><select value={linkWeek} onChange={e=>{setLinkWeek(Number(e.target.value));setLinkItem('');}}>{Array.from({length:data.courses.find(c=>c.id===linkCourse)?.week_count||13},(_,n)=><option key={n+1} value={n+1}>Week {n+1}</option>)}</select></FormRow>}
                    <FormRow label="Material type"><select value={linkKind} onChange={e=>setLinkKind(e.target.value as Resource['kind'])}>{(['handwritten','annotated','slides','textbook','exam_paper','exam_solution','other'] as const).map(k=><option key={k} value={k}>{k==='handwritten'?'Handwritten notes':k==='annotated'?'Annotated slides':k==='slides'?'Original slides':k==='textbook'?'Textbook':k==='exam_paper'?'Previous exam paper':k==='exam_solution'?'Exam solution':'Other'}</option>)}</select></FormRow>
                    {linkScope==='week'&&<FormRow label="Attach to study item (optional)"><select value={linkItem} onChange={e=>setLinkItem(e.target.value)}><option value="">Entire week</option>{data.items.filter(i=>i.course_id===linkCourse&&i.week_number===linkWeek).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></FormRow>}
                    <button className="btn primary full" disabled={!linkCourse||busy||!!linkingFileId} aria-busy={linkingFileId===selectedPdf.id} onClick={()=>linkDriveFile(selectedPdf)}>{linkingFileId===selectedPdf.id?<LoaderCircle size={16} className="spin"/>:<Link2 size={16}/>} {linkingFileId===selectedPdf.id?'Linking…':'Confirm link'}</button>
                    <p className="resources-link-help">Only the selected PDF will be linked. Nothing is linked automatically.</p>
                  </>}
                </>}
              </Card></div>
            </div>
          </>}
        </>}
      </main>
      {finishReview&&active&&<div className="dialog-backdrop" role="presentation"><div className="dialog focus-review-dialog" role="dialog" aria-modal="true" aria-label="Review focus session"><button className="dialog-close" onClick={()=>setFinishReview(false)} aria-label="Cancel and keep paused"><X size={18}/></button><h2>Review focus session</h2><p>How much of this session was focused study?</p><div className="focus-review-duration"><span>Recorded active time</span><strong>{duration(reviewLimit)}</strong></div><FocusDurationFields seconds={finishSeconds} maximum={reviewLimit} onChange={setFinishSeconds}/><p className="focus-review-help">Adjust for idle time if needed. Maximum: {formatFocusDuration(reviewLimit)}.</p><div className="dialog-actions"><button className="btn secondary" onClick={()=>setFinishReview(false)}>Keep paused</button><button className="btn primary" disabled={focusBusy||active.status!=='paused'||!Number.isInteger(Number(finishSeconds))||Number(finishSeconds)<0||Number(finishSeconds)>reviewLimit} onClick={finish}>{focusBusy?(Number(finishSeconds)===0?'Discarding…':'Saving timer…'):(Number(finishSeconds)===0?'Discard empty session':'Save session')}</button></div></div></div>}
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{tabs.map(t=><button key={t.id} className={tab===t.id?'current':''} onClick={()=>navigate(t.id)}><t.icon size={19}/><span>{t.label}</span></button>)}</nav>
    {pdfOpening&&<PdfOpeningOverlay title={pdfOpening.title} status={pdfOpening.status} error={pdfOpening.message}
      requestId={pdfOpening.requestId} onCancel={closePdf}
      onRetry={()=>previewPdf(pdfOpening.fileId,pdfOpening.title,pdfOpening.resourceId,pdfOpening.page)}/>}
    {pdf&&<PdfWorkspace pdf={pdf} items={presentedItems} pendingItems={pendingItems} completingIds={completingIds}
      related={data.resources.filter(r=>r.course_id===pdf.courseId&&(r.week_number===pdf.weekNumber||r.week_number===null))}
      onClose={closePdf} onPage={changePdfPage} onToggleItem={toggle}
      onFocus={item=>{closePdf();startFrom(item);}}
      onOpenResource={r=>{if(r.source==='drive'&&r.drive_file_id)previewPdf(r.drive_file_id,r.title,r.id,r.last_page);else if(r.url)window.open(r.url,'_blank','noopener,noreferrer');}}/>}
  </div>;
}
