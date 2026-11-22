'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3,
  Cloud, ExternalLink, FileText, Folder, GraduationCap, Home, Link2, ListTodo, LoaderCircle, FolderCheck, ScanSearch,
  Pause, Play, Plus, RotateCcw, Search, Square, Timer, Trash2, X, Sparkles, Sun, Moon, Target, Layers3, AlertTriangle, MoreHorizontal, BarChart3, LogOut
} from 'lucide-react';
import { api, pdfBlob } from '@/lib/api';
import { formatLocalClock, formatLocalDate } from '@/lib/clock';
import { applyMutation, type MutationHint } from '@/lib/snapshot-cache';
import { describeSnapshotFailure, fetchSnapshotWithRetry, type SnapshotLoadProblem } from '@/lib/snapshot-loading';
import { Badge, Card, EmptyState, FormRow, SectionTitle } from '@/components/common';
import { PdfWorkspace } from '@/components/pdf-workspace';
import { CoursePlanner } from '@/components/course-planner';
import { TasksPlanner } from '@/components/tasks-planner';
import { isActionable, isOverdue, todayPriorities, upcomingDeadlines, focusTasksForContext } from '@/lib/task-view';
import { todayStudyCourses, nextSevenDays, nextDeadlineDays, agendaForDate } from '@/lib/home-view';
import { firebaseAuth, onAuthStateChanged, signIn, signOutUser, useFirebase } from '@/lib/auth';
import { type DriveEntry, type DriveList, type FocusSession, type Item,
  type Resource, type Snapshot, type Tab, type DriveIndexed, type DriveSource, type DriveIndexResponse, type DriveScanResponse, duration,
  elapsedFocus, formatDate, kindLabels, localToday } from '@/lib/types';

type DriveStatus = { connected: boolean; configured: boolean };
const empty: Snapshot = {courses:[], weeks:[], items:[], resources:[], sessions:[], semesters:[]};
const pageNames: Record<Tab,string> = {today:'Today', courses:'Study Planner', tasks:'Tasks', calendar:'Calendar', focus:'Focus', library:'Resource Library'};
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
  const [data,setData] = useState<Snapshot>(empty);
  const [loading,setLoading] = useState(true);
  const [snapshotReady,setSnapshotReady] = useState(false);
  const [refreshing,setRefreshing] = useState(false);
  const [snapshotIssue,setSnapshotIssue] = useState<SnapshotLoadProblem|null>(null);
  const loadedUserRef=useRef<string|null>(null);
  const loadRequestRef=useRef(0);
  const [busy,setBusy] = useState(false);
  const [pendingItems,setPendingItems] = useState<Set<string>>(()=>new Set());
  const pendingItemsRef=useRef<Set<string>>(new Set());
  const lastLoadedAtRef=useRef(0);
  const [error,setError] = useState('');
  const [courseId,setCourseId] = useState('');
  const [weekNumber,setWeekNumber] = useState(1);
  const [now,setNow] = useState(Math.floor(Date.now()/1000));
  const [clockReady,setClockReady] = useState(false);
  const [pdf,setPdf] = useState<{url:string;title:string;page:number;resourceId?:string;courseId?:string;weekNumber?:number}|null>(null);
  const pdfBookmarkTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const pdfBookmarkPendingRef=useRef<{id:string;page:number}|null>(null);
  const pdfBookmarkWriteRef=useRef<Promise<void>>(Promise.resolve());

  const [taskForm,setTaskForm] = useState(false);
  const [priorityFilter,setPriorityFilter] = useState<'all'|'course'|'personal'>('all');
  const [homeFocusMode,setHomeFocusMode] = useState<'25'|'50'|'90'|'free'>('25');
  const [calendarJump,setCalendarJump] = useState<{date:string;token:number}|null>(null);
  const [homeSelectedDate,setHomeSelectedDate] = useState<string|null>(null);
  const [courseLandingItem,setCourseLandingItem] = useState<{id:string;weekNumber:number|null}|null>(null);
  const [taskJump,setTaskJump] = useState<{id:string;token:number}|null>(null);
  const [taskLandingMode,setTaskLandingMode] = useState<'today'|'upcoming'|'completed'>('today');
  const [focusCourse,setFocusCourse] = useState('');
  const [focusItem,setFocusItem] = useState('');
  const [focusMode,setFocusMode] = useState<'25'|'50'|'90'|'free'>('50');
  const [finishReview,setFinishReview] = useState(false);
  const [finishSeconds,setFinishSeconds] = useState('0');
  const [weeklyGoal,setWeeklyGoal] = useState(20);

  const [drive,setDrive] = useState<DriveStatus>({connected:false,configured:false});
  const [driveFiles,setDriveFiles] = useState<DriveEntry[]>([]);
  const [folderPath,setFolderPath] = useState<{id:string;name:string}[]>([{id:'root',name:'My Drive'}]);
  const [driveNext,setDriveNext] = useState<string|null>(null);
  const [driveBusy,setDriveBusy] = useState(false);
  const [sourceFolder,setSourceFolder] = useState<DriveSource|null>(null);
  const [driveIndex,setDriveIndex] = useState<DriveIndexed[]>([]);
  const [scanBusy,setScanBusy] = useState(false);
  const [indexFilter,setIndexFilter] = useState<'unlinked'|'all'|'needs-review'>('unlinked');
  const [visibleCount,setVisibleCount] = useState(30);
  const [linkCourse,setLinkCourse] = useState('');
  const [linkWeek,setLinkWeek] = useState(1);
  const [linkScope,setLinkScope] = useState<'course'|'week'>('week');
  const [linkKind,setLinkKind] = useState<Resource['kind']>('handwritten');
  const [linkItem,setLinkItem] = useState('');

  useEffect(()=>{
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, u=>{
      pendingItemsRef.current.clear();setPendingItems(new Set());
      setUser(u);setAuthReady(true);
    });
  },[]);
  useEffect(()=>{
    // Render the clock only after hydration to avoid server/client time mismatches.
    setNow(Math.floor(Date.now()/1000));
    setClockReady(true);
    // A running timer needs second-level updates; the ordinary header clock does not.
    const running=data.sessions.some(session=>session.status==='running');
    const id=window.setInterval(()=>setNow(Math.floor(Date.now()/1000)),running?1000:30000);
    return ()=>clearInterval(id);
  },[data.sessions]);
  useEffect(()=>{
    const preference=window.localStorage.getItem('studyhub-theme');
    if(preference==='dark'||preference==='light')setTheme(preference);
  },[]);
  const toggleTheme=()=>setTheme(previous=>{const next=previous==='light'?'dark':'light';window.localStorage.setItem('studyhub-theme',next);return next;});
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
    if (!hadSnapshot) {
      // Never show data from a previously signed-in account.
      setData(empty);setSnapshotReady(false);setSnapshotIssue(null);setLoading(true);
    } else setRefreshing(true);
    try {
      const snap=await fetchSnapshotWithRetry(()=>api<Snapshot>('/api/snapshot',user,{timeoutMs:15000}));
      if (requestNumber!==loadRequestRef.current) return false;
      // Keep pending checkbox changes visible if a manual refresh finishes mid-save.
      setData(previous=>pendingItemsRef.current.size ? { ...snap, items:snap.items.map(item=>{
        if(!pendingItemsRef.current.has(item.id)) return item;
        return previous.items.find(old=>old.id===item.id)||item;
      }) } : snap);
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
  const act = async(fn:()=>Promise<unknown>, mutation?:MutationHint):Promise<boolean>=>{
    setBusy(true);setError('');
    try {
      const result=await fn();
      if(mutation){
        if(mutation.collection!=='none') {
          if(!mutation.deleteId&&(!result||typeof result!=='object'||!('id' in result))){
            // A write may have succeeded even if the response shape changed. Reconcile once.
            const refreshed=await load();
            if(!refreshed)throw new Error('Saved, but could not synchronize the latest state. Refresh to verify.');
          }else setData(previous=>applyMutation(previous,mutation,result));
        }
      } else {
        const refreshed=await load();
        if(!refreshed)setError('Changes were saved, but the dashboard could not refresh. Use the refresh button to reload your data.');
      }
      return true;
    } catch(e) {setError(e instanceof Error?e.message:'Action failed');return false;}
    finally {setBusy(false);}
  };
  const selectedCourse = data.courses.find(c=>c.id===courseId&&!c.archived);
  const selectedWeek = data.weeks.find(w=>w.course_id===courseId && w.number===weekNumber);
  const activeCourseIds = new Set(data.courses.filter(c=>!c.archived).map(c=>c.id));
  const tasks = data.items.filter(i=>isActionable(i)&&(!i.course_id||activeCourseIds.has(i.course_id)));
  const today=localToday();
  const openTasks = tasks.filter(i=>!i.done);
  const plannedToday=openTasks.filter(i=>i.planned_date===today);
  const todayWork=todayPriorities(openTasks,today);
  const overdue=todayWork.filter(i=>isOverdue(i,today));
  const upcoming=upcomingDeadlines(openTasks,today);
  const studyGroups=todayStudyCourses(data.courses,data.items,today);
  const calendarDays=nextSevenDays(today,openTasks);
  const homeAgenda=homeSelectedDate?agendaForDate(openTasks,homeSelectedDate):[];
  const filteredPriorities=todayWork.filter(i=>priorityFilter==='all'||(priorityFilter==='course'?!!i.course_id:!i.course_id));
  const hour=new Date(now*1000).getHours();
  const hello=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  const firstName=user?.displayName?.trim().split(/\s+/)[0]||'';
  const profileName=user?.displayName?.trim()||'Study Hub';
  const profileInitials=profileName.split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('');
  const greeting=overdue.length ? `${overdue.length} ${overdue.length===1?'task needs':'tasks need'} your attention.` :
    todayWork.length ? `${todayWork.length} ${todayWork.length===1?'priority':'priorities'} for today.` : 'Your day is yours to plan.';
  const greetingDetail=overdue.length ? 'Overdue work comes first. Clear or reschedule what matters, then return to studying.' :
    todayWork.length ? 'Your plan is ready. Make a little progress, one task at a time.' :
    'No work is due or planned for today. Pick up a course or plan something new.';
  const dateLabel=clockReady?formatLocalDate(now*1000):'—';
  const timeLabel=clockReady?formatLocalClock(now*1000):'--:--';
  const active=data.sessions.find(s=>s.status==='running'||s.status==='paused');
  const currentWeekStart=useMemo(()=>{const d=new Date();d.setHours(0,0,0,0);const weekday=(d.getDay()+6)%7;d.setDate(d.getDate()-weekday);return Math.floor(d.getTime()/1000);},[today]);
  const weekSeconds=data.sessions.filter(s=>s.status==='finished'&&s.ended_at && s.ended_at>=currentWeekStart).reduce((n,s)=>n+(s.focus_seconds||0),0);
  const totalSeconds=data.sessions.filter(s=>s.status==='finished').reduce((n,s)=>n+(s.focus_seconds||0),0);
  const weekPct=Math.min(100,Math.round((weekSeconds/(weeklyGoal*3600))*100));
  const toggle=(item:Item)=>{
    if(pendingItemsRef.current.has(item.id))return;
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
        if(!item.done&&saved.done&&saved.repeat&&saved.repeat!=='none'){
          // Recurring completion creates a successor on the server. Fetch items only.
          // A failed follow-up read must not undo a successfully committed completion.
          try {
            const allItems=await api<Item[]>('/api/items',user);
            if(useFirebase&&firebaseAuth?.currentUser?.uid!==activeUid)return;
            setData(previous=>({...previous,items:allItems.map(i=>
              pendingItemsRef.current.has(i.id)&&i.id!==item.id?previous.items.find(old=>old.id===i.id)||i:i)}));
          }catch{
            setError('Completion saved, but the next recurring task did not load. Refresh to sync.');
          }
        }
      }catch(e){
        if(useFirebase&&firebaseAuth?.currentUser?.uid!==activeUid)return;
        // The user sees the authoritative old state if the write failed.
        setData(previous=>({...previous,items:previous.items.map(i=>i.id===item.id?item:i)}));
        setError(`Could not save “${item.title}”. ${e instanceof Error?e.message:'Please retry.'}`);
      }finally{
        pendingItemsRef.current.delete(item.id);
        setPendingItems(new Set(pendingItemsRef.current));
      }
    })();
  };
  const rememberCourse=(id:string)=>{setCourseId(id);if(id)window.localStorage.setItem('studyhub-last-course',id);};
  const rememberWeek=(week:number)=>{setWeekNumber(week);if(courseId)window.localStorage.setItem(`studyhub-last-week-${courseId}`,String(week));};
  const openCourse=(id:string,week?:number,landingItem?:Item)=>{
    const course=data.courses.find(c=>c.id===id&&!c.archived);
    if(!course){setTab('courses');return;}
    const saved=Number(window.localStorage.getItem(`studyhub-last-week-${id}`))||1;
    const selected=Math.max(1,Math.min(course.week_count,week||saved));
    setCourseLandingItem(landingItem?{id:landingItem.id,weekNumber:landingItem.week_number}:null);
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
    if(target==='calendar'){openCalendarDate(today);return;}
    if(target==='tasks'){setTaskLandingMode('today');setTaskJump(null);}
    if(target==='courses')setCourseLandingItem(null);
    setTaskForm(false);
    setTab(target);
  };
  const launchHomeFocus=()=>{
    if(active){setTab('focus');return;}
    setFocusCourse('');setFocusItem('');setFocusMode(homeFocusMode);
    void act(()=>api<FocusSession>('/api/sessions/start',user,{method:'POST',body:{item_id:null,course_id:null,week_number:null,mode:homeFocusMode}}),{collection:'sessions'});
  };
  const startFrom=(i?:Item)=>{
    // Personal tasks have no course; the selector still needs to retain their item ID.
    setFocusCourse(i?.course_id||'');setFocusItem(i?.id||'');
    setTab('focus');
  };
  const beginFocus=()=>void act(()=>{
    const item=data.items.find(i=>i.id===focusItem);
    return api<FocusSession>('/api/sessions/start',user,{method:'POST',body:{item_id:focusItem||null,course_id:focusCourse||null,week_number:item?.week_number||null,mode:focusMode}});
  },{collection:'sessions'});
  const sessionAction=(verb:'pause'|'resume')=>{if(!active)return;void act(()=>api<FocusSession>(`/api/sessions/${active.id}/${verb}`,user,{method:'POST'}),{collection:'sessions'});};
  const reviewFinish=()=>{if(!active)return;setFinishSeconds(String(Math.min(86400,elapsedFocus(active,now))));setFinishReview(true);};
  const finish=()=>{if(!active)return;void (async()=>{
    const id=active.id;
    const ok=await act(()=>api<FocusSession>(`/api/sessions/${id}/finish`,user,{method:'POST',body:{confirmed_seconds:Math.round(Number(finishSeconds))}}),{collection:'sessions'});
    if(ok)setFinishReview(false);
  })();};
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
  const previewPdf=(fileId:string,title:string,resourceId?:string,lastPage=1)=>void act(async()=>{
    const url=await pdfBlob(`/api/drive/files/${fileId}/pdf`,user);
    if (pdf) URL.revokeObjectURL(pdf.url);
    const r=data.resources.find(entry=>entry.id===resourceId);
    setPdf({url,title,resourceId,courseId:r?.course_id,weekNumber:r?.week_number??weekNumber,page:lastPage||1});
  },{collection:'none'});
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
  const closePdf=()=>{flushPdfBookmark();if(pdf)URL.revokeObjectURL(pdf.url);setPdf(null);};
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
  const linkDriveFile=(file:DriveEntry)=>void act(async()=>{
    if(!linkCourse)throw new Error('Select a course before linking a PDF');
    const saved=await api<Resource>('/api/resources',user,{method:'POST',body:{course_id:linkCourse,week_number:linkScope==='course'?null:linkWeek,title:file.name,kind:linkKind,source:'drive',drive_file_id:file.id,item_id:linkScope==='course'?null:(linkItem||null)}});
    // Reindex in the background; the returned resource updates the course immediately.
    void loadIndex();
    return saved;
  },{collection:'resources'});
  const selectBackupFolder=()=>void act(async()=>{
    if(currentFolder.id==='root')throw new Error('Choose the Goodnotes backup folder, not the root of your Drive');
    const result=await api<{folder:DriveSource}>('/api/drive/source-folder',user,{method:'POST',body:{folder_id:currentFolder.id}});
    setSourceFolder(result.folder);setDriveIndex([]);
  },{collection:'none'});
  const scanBackup=async()=>{
    setScanBusy(true);setError('');
    try {
      const result=await api<DriveScanResponse>('/api/drive/scan',user,{method:'POST'});
      setDriveIndex(result.files);
      setSourceFolder(f=>f?{...f,scanned_at:result.scanned_at}:f);
      setVisibleCount(30);
    }catch(e){setError(e instanceof Error?e.message:'Backup scan failed');}
    finally{setScanBusy(false);}
  };
  const confirmSuggestion=(entry:DriveIndexed)=>void act(async()=>{
    if (!entry.suggestion)throw new Error('This PDF needs manual course/week selection');
    const suggestion=entry.suggestion;
    const saved=await api<Resource>('/api/resources',user,{method:'POST',body:{course_id:suggestion.course_id,
      week_number:['textbook','handwritten'].includes(suggestion.kind)?null:suggestion.week_number,title:entry.name,kind:suggestion.kind,source:'drive',drive_file_id:entry.id}});
    // Reindex in the background; the returned resource updates the course immediately.
    void loadIndex();
    return saved;
  },{collection:'resources'});
  const indexedVisible=driveIndex.filter(f=>indexFilter==='all'||(indexFilter==='unlinked'?f.links.length===0:(!f.suggestion&&f.links.length===0)));
  const currentFolder=folderPath.at(-1)!;
  useEffect(()=>{if(tab==='library'&&drive.connected&&driveFiles.length===0)void browseDrive(currentFolder.id);},[tab,drive.connected]); // initial browse only

  if (useFirebase&&!authReady) return <div className="boot"><LoaderCircle className="spin"/><p>Checking sign-in…</p></div>;
  if (useFirebase&&!user) return <main className="login-shell"><Card className="login-card"><span className="brand-mark"><GraduationCap/></span><h1>Your private Study Hub</h1><p>Courses, notes, deadlines and focus time in one workspace. Only your authorized account can access the deployed app.</p><button className="btn primary" onClick={()=>void signIn()}>Sign in with Google</button></Card></main>;

  return <div className={`app-shell ${theme==='dark'?'theme-dark':''}`}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><BookOpen size={21}/></span><div><strong>Study Hub</strong><small>DTU</small></div></div>
      <div className="nav-label">MY WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{tabs.map(t=><button key={t.id} type="button" onClick={()=>navigate(t.id)} className={'nav-btn '+(tab===t.id?'current':'')} aria-current={tab===t.id?"page":undefined}><t.icon size={18}/>{t.label}{t.id==='tasks'&&openTasks.length>0&&<span className="nav-count">{openTasks.length}</span>}</button>)}</nav>
      {data.courses.some(c=>!c.archived)&&<div className="sidebar-courses"><div className="sidebar-courses-heading">COURSES</div>{data.courses.filter(c=>!c.archived).slice(0,6).map((c,index)=><button className={'sidebar-course-link'+(c.id===courseId&&tab==='courses'?' active':'')} key={c.id} onClick={()=>openCourse(c.id)}><span className={'sidebar-course-dot tone-'+(index%4)}/><span>{c.code} · {c.title}</span></button>)}</div>}<div className="sidebar-spacer"/>
      <div className="sidebar-bottom">
        <div className="sidebar-profile">
          <span className="sidebar-profile-avatar" aria-hidden="true">{profileInitials}</span>
          <div><strong title={profileName}>{profileName}</strong><small>DTU student</small></div>
        </div>
        <div className="sidebar-footer-row">
          <span className="sidebar-account"><span className="live-dot" aria-hidden="true"/>{useFirebase?'Private workspace':'Local development'}</span>
          {useFirebase&&<button type="button" className="sidebar-signout" aria-label="Sign out of Study Hub" onClick={()=>void signOutUser()}><LogOut size={15}/> Sign out</button>}
        </div>
      </div>
    </aside>
    <div className="main-area">
      <header className={'topbar'+(tab==='today'?' dashboard-topbar':'')}><div className="breadcrumb"><Sparkles size={16}/> PERSONAL HUB <span>/</span> <strong>{pageNames[tab]}</strong></div><div className="topbar-right">
          <span className="topbar-date">{dateLabel}</span>
          <span className="topbar-clock" title="Your local time (24-hour clock)" aria-label={`Local time ${timeLabel}`}><Clock3 size={14} aria-hidden="true"/><time dateTime={clockReady?new Date(now*1000).toISOString():undefined}>{timeLabel}</time></span>
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
          {snapshotIssue&&<details className="load-diagnostics"><summary>Technical details for troubleshooting</summary><code>{snapshotIssue.diagnostics}</code><p>For HTTP 500/503, check the Vercel Preview API function logs and Firebase environment variables; do not switch Preview to the Production Firebase project.</p></details>}
        </Card>:<>
          {tab==='today'&&<div className="dashboard-home">
            <div className="dashboard-intro">
              <span className="eyebrow"><Sparkles size={14}/> YOUR STUDY HUB</span>
              <h1>{hello}{firstName?`, ${firstName}`:''} <span aria-hidden="true">👋</span></h1>
              <p>Stay consistent, one focused step at a time.</p>
            </div>
            <div className="home-layout">
              <div className="home-main-column">
                <div className="home-stats-grid" aria-label="Study overview">
                  <div className="home-stat"><span className="home-stat-icon purple"><ListTodo size={23}/></span><strong>{todayWork.length}</strong><span>Tasks today</span></div>
                  <div className={'home-stat'+(overdue.length?' danger':'')}><span className="home-stat-icon red"><AlertTriangle size={23}/></span><strong>{overdue.length}</strong><span>Overdue</span></div>
                  <div className="home-stat"><span className="home-stat-icon purple"><CalendarDays size={23}/></span><strong>{upcoming.length}</strong><span>Upcoming deadlines</span></div>
                  <div className="home-stat"><span className="home-stat-icon blue"><BarChart3 size={23}/></span><strong>{(weekSeconds/3600).toFixed(1)} h</strong><span>Focus this week</span></div>
                </div>
                <section className="home-panel home-course-panel" aria-labelledby="home-courses-title">
                  <div className="home-panel-heading"><div className="home-heading-icon"><BookOpen size={21}/></div><div><h2 id="home-courses-title">Today’s study courses</h2><p>Coursework planned or due today, plus unfinished overdue work.</p></div><span className="home-count-pill">{studyGroups.length} {studyGroups.length===1?'course':'courses'}</span></div>
                  {studyGroups.length?<>
                    <div className="home-course-grid">
                      {studyGroups.slice(0,4).map((group,index)=>{
                        const weekLabel=group.weekNumbers.length===1?`Week ${group.weekNumbers[0]}`:group.weekNumbers.length?`Weeks ${group.weekNumbers.join(', ')}`:'Course tasks';
                        const progress=group.activityCount?Math.round(100*group.doneCount/group.activityCount):0;
                        return <div key={group.course.id} className={'home-course-tile tile-'+(index%4)+(Math.min(studyGroups.length,4)%2===1&&index===Math.min(studyGroups.length,4)-1?' compact-wide':'')}>
                          <div className="home-course-heading"><div className="home-course-icon"><BookOpen size={24}/></div><div className="home-course-title"><h3>{group.course.code} · {group.course.title}</h3><span>{weekLabel}</span></div>{group.overdueCount?<span className="home-overdue-pill">{group.overdueCount} overdue</span>:<span className="home-today-pill">Today</span>}</div>
                          <div className="home-course-progress"><span>{group.doneCount} / {group.activityCount} activities</span><div className="home-progress-track" role="progressbar" aria-label={`${group.course.title} selected week activity progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div style={{width:`${progress}%`}}/></div></div>
                          <div className="home-course-activities">
                            {group.tasks.slice(0,2).map(i=><div className={'home-course-task'+(isOverdue(i,today)?' late':'')} key={i.id}><input type="checkbox" aria-label={`Complete ${i.title}`} disabled={busy||pendingItems.has(i.id)} checked={i.done} onChange={()=>toggle(i)}/><button className="home-course-task-title" title={`Open ${i.title} in course`} onClick={()=>openCourse(group.course.id,i.week_number||undefined)}>{i.title}{group.weekNumbers.length>1&&i.week_number&&<small>W{i.week_number}</small>}</button>{isOverdue(i,today)&&<span className="home-overdue-pill compact">Overdue</span>}{i.resource_id&&<button className="home-task-resource" disabled={busy} onClick={()=>openTaskResource(i)} aria-label={`Open resource for ${i.title}`} title="Open linked resource"><BookOpen size={15}/></button>}</div>)}
                            {group.tasks.length>2&&<button className="home-extra-items" onClick={()=>navigate('tasks')}>+ {group.tasks.length-2} more tasks <ArrowRight size={13}/></button>}
                          </div>
                          <div className="home-course-actions"><button className="home-open-course" onClick={()=>openCourse(group.course.id,group.tasks[0]?.week_number||undefined)}>Open course <ArrowRight size={16}/></button><button className="home-subtle-button" aria-label={`View tasks for ${group.course.title}`} title="View all tasks" onClick={()=>navigate('tasks')}><MoreHorizontal size={20}/></button></div>
                        </div>;
                      })}
                    </div>
                    {studyGroups.length>4&&<button className="home-more-courses" onClick={()=>navigate('tasks')}>View work in {studyGroups.length-4} more {studyGroups.length===5?'course':'courses'} <ArrowRight size={14}/></button>}
                  </>:<div className="home-course-empty"><div className="home-heading-icon"><CheckCircle2 size={21}/></div><div><h3>No course work scheduled for today</h3><p>{selectedCourse?'You’re up to date on scheduled work. Continue your last course, or plan an activity from a weekly checklist.':'Create your first course and plan activities to see them here.'}</p></div><button className="home-mini-btn" onClick={()=>selectedCourse?openCourse(selectedCourse.id):setTab('courses')}>{selectedCourse?'Continue studying':'Open Study'} <ArrowRight size={15}/></button></div>}
                </section>
                <section className="home-panel home-priorities" aria-labelledby="home-priorities-title">
                  <div className="home-panel-heading"><div className="home-heading-icon"><CheckCircle2 size={21}/></div><div><h2 id="home-priorities-title">Today’s priorities</h2><p>Your planned, due, and overdue work.</p></div><div className="home-priority-filters" aria-label="Filter priorities">{(['all','course','personal'] as const).map(filter=><button key={filter} onClick={()=>setPriorityFilter(filter)} className={priorityFilter===filter?'active':''} aria-pressed={priorityFilter===filter}>{filter==='all'?'All':filter==='course'?'Course':'Personal'}</button>)}</div></div>
                  {filteredPriorities.length?<div className="home-priority-list">{filteredPriorities.slice(0,6).map(i=><div key={i.id} className={'home-priority-row'+(isOverdue(i,today)?' overdue':'')}><input type="checkbox" aria-label={`Complete ${i.title}`} disabled={busy||pendingItems.has(i.id)} checked={i.done} onChange={()=>toggle(i)}/><div className="home-priority-info"><strong>{i.title}</strong><small>{i.course_id?(data.courses.find(c=>c.id===i.course_id)?.code||'Course'):'Personal'}{i.week_number?` · Week ${i.week_number}`:''}{i.due_date&&i.due_date<today?` · Due ${dateText(i.due_date)}`:i.planned_date&&i.planned_date<today?` · Planned ${dateText(i.planned_date)}`:''}</small></div><span className={'home-priority-tag'+(isOverdue(i,today)?' overdue':'')}>{isOverdue(i,today)?'Overdue':'Today'}</span>{i.resource_id&&<button className="home-row-action" aria-label={`Open resource for ${i.title}`} disabled={busy} onClick={()=>openTaskResource(i)} title="Open linked resource"><BookOpen size={16}/></button>}<button className="home-row-action" aria-label={`Focus on ${i.title}`} disabled={busy} onClick={()=>startFrom(i)} title="Focus on task"><Play size={15}/></button></div>)}</div>:<div className="home-list-empty"><CheckCircle2 size={19}/> {priorityFilter==='all'?'Nothing overdue or due today. Enjoy a clear slate!':`No ${priorityFilter} priorities for today.`}</div>}
                  {filteredPriorities.length>6&&<button className="home-panel-link home-list-footer" onClick={()=>navigate('tasks')}>View {filteredPriorities.length-6} more tasks <ArrowRight size={14}/></button>}
                </section>
              </div>
              <div className="home-side-column">
                <section className="home-panel home-focus-widget" aria-labelledby="home-focus-title">
                  <div className="home-widget-heading"><span className="home-heading-icon"><Timer size={20}/></span><h2 id="home-focus-title">Focus session</h2></div>
                  <div className="home-focus-content"><div><strong>{active?duration(elapsedFocus(active,now)):homeFocusMode==='free'?'00:00':`${homeFocusMode}:00`}</strong><div className="home-focus-select-wrap">{active?<span className="home-focus-status">{active.status==='paused'?'Paused session':'Session in progress'}</span>:<select aria-label="Focus duration" value={homeFocusMode} onChange={e=>setHomeFocusMode(e.target.value as typeof homeFocusMode)}><option value="25">Pomodoro (25 / 5)</option><option value="50">Focus (50 min)</option><option value="90">Deep work (90 min)</option><option value="free">Stopwatch</option></select>}</div></div><button className="home-focus-play" disabled={busy} aria-label={active?'Open active focus session':'Start focus session'} onClick={launchHomeFocus}>{active?<ArrowRight size={28}/>:<Play size={28} fill="currentColor"/>}</button></div>
                  <p className="home-focus-note">{active?'Open Focus to pause, resume, or finish.':'Timed modes are targets; sessions are stopped manually.'}</p>
                </section>
                <section className="home-panel home-week-goal" aria-labelledby="home-goal-title"><div className="home-widget-heading"><span className="home-heading-icon blue"><Target size={20}/></span><h2 id="home-goal-title">Weekly focus goal</h2><span className="home-widget-stat">{(weekSeconds/3600).toFixed(1)} / {weeklyGoal} h</span></div><div className="home-progress-track" role="progressbar" aria-label="Weekly focus goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={weekPct}><div style={{width:`${weekPct}%`}}/></div><div className="home-goal-foot"><span>{weekPct}% of your goal</span><label>Goal <input type="number" min={1} max={80} aria-label="Weekly focus target in hours" value={weeklyGoal} onChange={e=>{const n=Math.max(1,Math.min(80,Number(e.target.value)||1));setWeeklyGoal(n);localStorage.setItem('studyhub-focus-goal',String(n));}}/> h/week</label></div><small className="home-local-note">Goal preference is stored on this device.</small></section>
                <section className="home-panel home-deadlines" aria-labelledby="home-deadlines-title"><div className="home-widget-heading"><span className="home-heading-icon"><CalendarDays size={20}/></span><h2 id="home-deadlines-title">Upcoming deadlines</h2><button className="home-panel-link" onClick={showUpcomingTasks}>View all <ArrowRight size={14}/></button></div>{upcoming.slice(0,3).map(i=><button className="home-deadline" key={i.id} onClick={()=>openDeadlineDestination(i)}><span className="home-deadline-date"><strong>{i.due_date!.slice(8,10)}</strong>{new Intl.DateTimeFormat('en-GB',{month:'short'}).format(new Date(i.due_date!+'T12:00:00'))}</span><span className="home-deadline-info"><strong>{i.title}</strong><small>{data.courses.find(c=>c.id===i.course_id)?.code||'Personal'}{i.week_number?` · Week ${i.week_number}`:''}</small></span><span className="home-days-away">{nextDeadlineDays(today,i.due_date!)===0?'Today':`${nextDeadlineDays(today,i.due_date!)}d`}</span></button>)}{!upcoming.length&&<p className="home-side-empty">Nothing due soon. Keep your momentum going.</p>}</section>
                <section className="home-panel home-week-strip" aria-labelledby="home-calendar-title"><div className="home-widget-heading"><span className="home-heading-icon"><CalendarDays size={20}/></span><h2 id="home-calendar-title">Next 7 days</h2><button className="home-panel-link" onClick={()=>openCalendarDate(homeSelectedDate||today)}>Full calendar <ArrowRight size={14}/></button></div><div className="home-day-grid">{calendarDays.map((day,index)=><button key={day.date} className={'home-day'+(index===0?' current':'')+(homeSelectedDate===day.date?' selected':'')} aria-label={`Show ${day.weekday} ${day.day} tasks inline${day.count?`, ${day.count} scheduled items`:''}`} aria-pressed={homeSelectedDate===day.date} aria-controls={homeSelectedDate?'home-day-agenda':undefined} title={`${day.count} planned/due items`} onClick={()=>toggleHomeAgenda(day.date)}><span>{day.weekday}</span><strong>{day.day}</strong><span className={'home-day-dot'+(day.count?' has-work':'')}/></button>)}</div>{homeSelectedDate&&<div id="home-day-agenda" className="home-inline-agenda"><div className="home-inline-agenda-header"><div><strong>{new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'short'}).format(new Date(homeSelectedDate+'T12:00:00'))}</strong><span>{homeAgenda.length} {homeAgenda.length===1?'item':'items'}</span></div><button type="button" aria-label="Close day details" className="home-agenda-close" onClick={()=>setHomeSelectedDate(null)}><X size={16}/></button></div>{homeAgenda.length?<div className="home-inline-agenda-list">{homeAgenda.slice(0,5).map(({item,reason})=><div className="home-inline-agenda-item" key={item.id}><input type="checkbox" checked={item.done} disabled={busy} aria-label={`Complete ${item.title}`} onChange={()=>toggle(item)}/><button type="button" className="home-agenda-item-main" onClick={()=>openDeadlineDestination(item)}><strong>{item.title}</strong><small>{data.courses.find(c=>c.id===item.course_id)?.code||'Personal'}{item.week_number?` · Week ${item.week_number}`:''} · {reason==='planned-and-due'?'Planned & due':reason==='planned'?'Planned':'Due'}</small></button><ArrowRight size={15} aria-hidden="true"/></div>)}{homeAgenda.length>5&&<p className="home-agenda-more">+{homeAgenda.length-5} additional items</p>}</div>:<p className="home-side-empty">No tasks planned or due on this day.</p>}<button type="button" className="home-panel-link home-agenda-full" onClick={()=>openCalendarDate(homeSelectedDate)}>Open full day <ArrowRight size={14}/></button></div>}</section>
              </div>
            </div>
          </div>}

          {tab==='courses'&&<CoursePlanner data={data} user={user} busy={busy} pendingItems={pendingItems}
            courseId={courseId} weekNumber={weekNumber} landingItem={courseLandingItem} selectCourse={rememberCourse} selectWeek={rememberWeek}
            run={act} toggleItem={toggle} focusOn={startFrom}
            openResource={r=>{if(r.source==='drive'&&r.drive_file_id)previewPdf(r.drive_file_id,r.title,r.id,r.last_page);else if(r.url)window.open(r.url,'_blank','noopener,noreferrer');}}
            openDrive={(id,week,kind,scope)=>{setLinkCourse(id);setLinkWeek(week);setLinkScope(scope);setLinkKind(kind);setLinkItem('');setTab('library');}}
          />}

          {tab==='tasks'&&<TasksPlanner items={tasks} courses={data.courses} user={user} busy={busy} pendingItems={pendingItems}
            run={act} onToggle={toggle} onFocus={startFrom} onOpenResource={openTaskResource} createOpen={taskForm} setCreateOpen={setTaskForm}
            initialTaskMode={taskLandingMode} taskJump={taskJump} onTaskJumpHandled={()=>setTaskJump(null)}/>}

          {tab==='calendar'&&<TasksPlanner items={tasks} courses={data.courses} user={user} busy={busy} pendingItems={pendingItems}
            run={act} onToggle={toggle} onFocus={startFrom} onOpenResource={openTaskResource} createOpen={taskForm} setCreateOpen={setTaskForm}
            calendarOnly calendarJump={calendarJump}/>}

          {tab==='focus'&&<>
            <div className="page-heading"><div><span className="eyebrow"><Target size={13}/> DEEP WORK</span><h1>Find your flow.</h1><p>Settle into a distraction-free session. Every minute counts.</p></div><Badge tone={active?active.status==='running'?'good':'warning':'muted'}>{active?active.status:'Ready'}</Badge></div>
            <div className="focus-layout"><Card className="focus-card">
              {!active&&<div className="focus-settings"><FormRow label="Course (optional)"><select value={focusCourse} onChange={e=>{setFocusCourse(e.target.value);setFocusItem('');}}><option value="">General / personal</option>{data.courses.filter(c=>!c.archived).map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></FormRow><FormRow label="Focus task (optional)"><select value={focusItem} onChange={e=>setFocusItem(e.target.value)}><option value="">No linked task</option>{focusTasksForContext(data.items,focusCourse).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></FormRow></div>}
              {active&&<div className="focus-context"><Badge tone="good">Active session</Badge><strong>{data.items.find(i=>i.id===active.item_id)?.title||data.courses.find(c=>c.id===active.course_id)?.title||'General focus'}</strong></div>}
              <div className="focus-modes">{(['25','50','90','free'] as const).map(m=><button key={m} disabled={!!active} className={focusMode===m?'current':''} onClick={()=>setFocusMode(m)}>{m==='free'?'Stopwatch':`${m} min`}</button>)}</div>
              <div className="timer-dial"><span className="dial-label">{active?active.status==='paused'?'PAUSED':'FOCUSING':focusMode==='free'?'STOPWATCH':'FOCUS TARGET'}</span><strong>{active?duration(elapsedFocus(active,now)):focusMode==='free'?'00:00:00':duration(Number(focusMode)*60)}</strong><span className="dial-sub">{active?.mode!=='free'&&active?`Target: ${active.mode} minutes`:active?'Count-up session':'Ready when you are'}</span></div>
              {active? <div className="focus-buttons"><button className="btn secondary" onClick={()=>sessionAction(active.status==='running'?'pause':'resume')} disabled={busy}>{active.status==='running'?<Pause size={17}/>:<Play size={17}/>} {active.status==='running'?'Pause':'Resume'}</button><button className="btn primary" onClick={reviewFinish}><Square size={15}/> Finish & review</button></div>:<button className="btn primary focus-start" disabled={busy} onClick={beginFocus}><Play size={18}/> Start focusing</button>}
              <p className="focus-tip">Sessions persist after closing the tab. Timed modes are targets, not automatic stop timers yet. Finish manually and correct any idle time in the review.</p>
            </Card><div className="stack"><Card><SectionTitle title="Your focus statistics"/><div className="focus-stat"><span>This week</span><strong>{(weekSeconds/3600).toFixed(1)} hours</strong></div><div className="focus-stat"><span>All time</span><strong>{(totalSeconds/3600).toFixed(1)} hours</strong></div><div className="focus-stat"><span>Completed sessions</span><strong>{data.sessions.filter(s=>s.status==='finished').length}</strong></div></Card><Card><SectionTitle title="Recent sessions"/>{data.sessions.filter(s=>s.status==='finished').sort((a,b)=>(b.ended_at||0)-(a.ended_at||0)).slice(0,5).map(s=><div className="session-row" key={s.id}><span><Check size={15}/></span><div><strong>{data.items.find(i=>i.id===s.item_id)?.title||'Focus session'}</strong><small>{new Date(s.started_at*1000).toLocaleDateString()} · {Math.round((s.focus_seconds||0)/60)} min</small></div></div>)}{!data.sessions.some(s=>s.status==='finished')&&<p className="muted">Your finished sessions will appear here.</p>}</Card></div></div>
            {finishReview&&active&&<div className="dialog-backdrop" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-label="Review focus session"><button className="dialog-close" onClick={()=>setFinishReview(false)} aria-label="Cancel"><X size={18}/></button><h2>Review session</h2><p>Confirm your actual focus time. If you left the browser open, reduce the time to exclude inactivity.</p><FormRow label={`Actual focus seconds (maximum ${Math.min(86400,elapsedFocus(active,now))})`}><input type="number" min={0} max={Math.min(86400,elapsedFocus(active,now))} value={finishSeconds} onChange={e=>setFinishSeconds(e.target.value)}/></FormRow><div className="dialog-actions"><button className="btn secondary" onClick={()=>setFinishReview(false)}>Keep running</button><button className="btn primary" disabled={busy||!Number.isInteger(Number(finishSeconds))||Number(finishSeconds)<0||Number(finishSeconds)>Math.min(86400,elapsedFocus(active,now))} onClick={finish}>Save session</button></div></div></div>}
          </>}

          {tab==='library'&&<>
            <div className="page-heading"><div><span className="eyebrow"><Folder size={13}/> CONNECTED MATERIALS</span><h1>Your knowledge library.</h1><p>Find your Goodnotes PDFs, review suggested matches, and read everything here.</p></div><Badge tone={drive.connected?'good':'muted'}>{drive.connected?'Drive connected':'Drive not connected'}</Badge></div>
            <div className="two-col-layout course-layout"><div className="stack">
              <Card><SectionTitle title="Google Drive connection"/>
                <p className="muted">Use the PDF backup you already have in Goodnotes. Study Hub indexes file names and folder paths without copying the notes.</p>
                {drive.connected?<div className="connection-status"><span className="live-dot"/> Connected privately <button className="text-button" onClick={()=>{if(confirm('Disconnect Google Drive and erase the local folder index? Existing linked resources will remain.'))void act(async()=>{await api('/api/drive/disconnect',user,{method:'DELETE'});setDrive({connected:false,configured:drive.configured});setDriveFiles([]);setSourceFolder(null);setDriveIndex([]);},{collection:'none'});}}>Disconnect</button></div>:<button className="btn primary" disabled={!drive.configured||busy} onClick={connectDrive}><Cloud size={16}/> Connect my Drive</button>}
                {!drive.configured&&<div className="subtle-notice">First add your own Google OAuth credentials to <code>backend/.env</code>. The rest of Study Hub works offline.</div>}
              </Card>
              {drive.connected&&<Card><SectionTitle title="Your Goodnotes backup folder" aside={sourceFolder?<Badge tone="good"><FolderCheck size={13}/> Selected</Badge>:<Badge>Not selected</Badge>}/>
                {sourceFolder?<div className="backup-source"><div><strong><FolderCheck size={16}/> {sourceFolder.name}</strong><small>{sourceFolder.scanned_at?`Last scanned ${new Date(sourceFolder.scanned_at*1000).toLocaleString()}`:'Not scanned yet'}</small></div><button className="btn primary small" disabled={scanBusy||busy} onClick={()=>void scanBackup()}>{scanBusy?<LoaderCircle size={15} className="spin"/>:<ScanSearch size={15}/>} {scanBusy?'Scanning…':'Scan for PDFs'}</button></div>:<p className="subtle-notice">Browse below to open your Goodnotes backup folder, then choose <strong>Use this folder</strong>. Scanning is manual, so nothing happens in the background.</p>}
                <div className="folder-picker-heading"><strong>Browse Drive folders</strong><button className="icon-btn" title="Refresh folder" disabled={driveBusy} onClick={()=>void browseDrive(currentFolder.id)}><RotateCcw size={16}/></button></div>
                <div className="folder-path"><button onClick={()=>{setFolderPath([{id:'root',name:'My Drive'}]);void browseDrive('root');}}>My Drive</button>{folderPath.slice(1).map(f=><span key={f.id}> / {f.name}</span>)}</div>
                <div className="folder-picker-actions">{folderPath.length>1&&<button className="btn secondary small" onClick={backFolder}><ArrowLeft size={14}/> Back</button>}{currentFolder.id!=='root'&&<button className="btn secondary small" disabled={busy} onClick={selectBackupFolder}><FolderCheck size={14}/> Use this folder</button>}</div>
                {driveBusy&&<p className="muted"><LoaderCircle size={15} className="spin"/> Loading Drive folders…</p>}
                {driveFiles.map(f=><div className="drive-row" key={f.id}><span className="resource-icon">{f.mimeType==='application/pdf'?<FileText size={18}/>:<Folder size={18}/>}</span><div className="task-content"><strong>{f.name}</strong><small>{f.mimeType==='application/pdf'?'PDF document':'Folder'}{f.modifiedTime?' · '+new Date(f.modifiedTime).toLocaleDateString():''}</small></div>{f.mimeType==='application/pdf'?<><button className="icon-btn" title="Read PDF" onClick={()=>previewPdf(f.id,f.name)}><BookOpen size={16}/></button><button className="btn secondary small" disabled={!linkCourse||busy} onClick={()=>linkDriveFile(f)}>Link</button></>:<button className="icon-btn" title="Open folder" onClick={()=>openFolder(f)}><ArrowRight size={17}/></button>}</div>)}
                {!driveBusy&&driveFiles.length===0&&<p className="muted">No PDFs or subfolders here.</p>}
                {driveNext&&<button className="btn secondary full" onClick={()=>void browseDrive(currentFolder.id,true,driveNext)}>Load more</button>}
              </Card>}
              {drive.connected&&sourceFolder&&<Card><SectionTitle title="Discovered backup PDFs" aside={<Badge tone="good">{driveIndex.length} indexed</Badge>}/>
                <p className="muted compact">Suggestions come from course codes and week labels in filenames/folders. <strong>Nothing is linked automatically.</strong> Confirm a suggestion or use manual controls on the right.</p>
                <div className="index-controls"><label>Show <select value={indexFilter} onChange={e=>{setIndexFilter(e.target.value as typeof indexFilter);setVisibleCount(30);}}><option value="unlinked">Unlinked files</option><option value="needs-review">Need manual matching</option><option value="all">All files</option></select></label><button className="btn secondary small" onClick={()=>void loadIndex()}><RotateCcw size={14}/> Refresh</button></div>
                {indexedVisible.slice(0,visibleCount).map(f=><div className="indexed-pdf" key={f.id}><div className="indexed-pdf-head"><span className="resource-icon"><FileText size={18}/></span><div className="task-content"><strong>{f.name}</strong><small title={f.path}>{f.path}{f.modifiedTime?` · Updated ${new Date(f.modifiedTime).toLocaleDateString()}`:''}</small></div>{f.links.length>0?<Badge tone="good">Linked</Badge>:null}</div>
                  {f.suggestion?<div className="match-recommendation"><span><Sparkles size={14}/> Suggested: {f.suggestion.course_code} · Week {f.suggestion.week_number} · {f.suggestion.kind}</span><Badge tone={f.suggestion.confidence==='high'?'good':'warning'}>{f.suggestion.confidence} confidence</Badge></div>:<p className="match-missing">No clear course/week match — select the fields on the right to link manually.</p>}
                  <div className="indexed-actions"><button className="btn secondary small" onClick={()=>previewPdf(f.id,f.name)}><BookOpen size={14}/> Preview</button>{f.links.length===0&&f.suggestion&&<button className="btn primary small" disabled={busy} onClick={()=>confirmSuggestion(f)}><Check size={14}/> Confirm match</button>}{f.links.length===0&&<button className="btn secondary small" disabled={!linkCourse||busy} onClick={()=>linkDriveFile(f)}><Link2 size={14}/> Link manually</button>}</div>
                </div>)}
                {indexedVisible.length===0&&<EmptyState icon={<FileText size={23}/>} title="Nothing here yet" detail="Scan your selected backup folder, or switch the list filter."/>}
                {indexedVisible.length>visibleCount&&<button className="btn secondary full" onClick={()=>setVisibleCount(n=>n+30)}>Show more ({indexedVisible.length-visibleCount} remaining)</button>}
              </Card>}
            </div><div className="stack"><Card><SectionTitle title="Link to a course or teaching week"/><p className="muted compact">Choose Course Library for whole-course books and notebooks, or a specific week for lecture materials, before clicking <strong>Link manually</strong>. You stay in control.</p><FormRow label="Course"><select value={linkCourse} onChange={e=>{setLinkCourse(e.target.value);setLinkWeek(1);setLinkItem('');}}><option value="">Select course</option>{data.courses.filter(c=>!c.archived).map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></FormRow><FormRow label="Resource belongs to"><select value={linkScope} onChange={e=>setLinkScope(e.target.value as 'course'|'week')}><option value="course">Course Library (all weeks)</option><option value="week">One teaching week</option></select></FormRow>{linkScope==='week'&&<FormRow label="Week"><select value={linkWeek} onChange={e=>{setLinkWeek(Number(e.target.value));setLinkItem('');}}>{Array.from({length:data.courses.find(c=>c.id===linkCourse)?.week_count||13},(_,n)=><option key={n+1} value={n+1}>Week {n+1}</option>)}</select></FormRow>}<FormRow label="Material type"><select value={linkKind} onChange={e=>setLinkKind(e.target.value as Resource['kind'])}>{(['handwritten','annotated','slides','textbook','other'] as const).map(k=><option key={k} value={k}>{k==='handwritten'?'Handwritten notes':k==='annotated'?'Annotated slides':k==='slides'?'Original slides':k==='textbook'?'Textbook':'Other'}</option>)}</select></FormRow>{linkScope==='week'&&<FormRow label="Attach to study item (optional)"><select value={linkItem} onChange={e=>setLinkItem(e.target.value)}><option value="">Entire week</option>{data.items.filter(i=>i.course_id===linkCourse&&i.week_number===linkWeek).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></FormRow>}</Card>
              <Card className="hint-card"><h3>Keep using Goodnotes</h3><p>Continue handwriting there. After Goodnotes finishes backing up, press <strong>Scan for PDFs</strong> to update this library. Read linked PDF copies inside Study Hub. The original notes remain editable in Goodnotes.</p></Card>
            </div></div>
          </>}
        </>}
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{tabs.map(t=><button key={t.id} className={tab===t.id?'current':''} onClick={()=>setTab(t.id)}><t.icon size={19}/><span>{t.label}</span></button>)}</nav>
    {pdf&&<PdfWorkspace pdf={pdf} items={data.items}
      related={data.resources.filter(r=>r.course_id===pdf.courseId&&(r.week_number===pdf.weekNumber||r.week_number===null))}
      onClose={closePdf} onPage={changePdfPage} onToggleItem={toggle}
      onFocus={item=>{closePdf();startFrom(item);}}
      onOpenResource={r=>{if(r.source==='drive'&&r.drive_file_id)previewPdf(r.drive_file_id,r.title,r.id,r.last_page);else if(r.url)window.open(r.url,'_blank','noopener,noreferrer');}}/>}
  </div>;
}
