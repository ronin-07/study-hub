'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3,
  Cloud, ExternalLink, FileText, Folder, GraduationCap, Home, Link2, ListTodo, LoaderCircle, FolderCheck, ScanSearch,
  Pause, Play, Plus, RotateCcw, Search, Square, Timer, Trash2, X, Sparkles, Sun, Moon, Zap, Target, Layers3, AlertTriangle
} from 'lucide-react';
import { api, pdfBlob } from '@/lib/api';
import { Badge, Card, EmptyState, FormRow, SectionTitle } from '@/components/common';
import { PdfWorkspace } from '@/components/pdf-workspace';
import { CoursePlanner } from '@/components/course-planner';
import { TasksPlanner } from '@/components/tasks-planner';
import { isActionable, isOverdue, todayPriorities, upcomingDeadlines, focusTasksForContext } from '@/lib/task-view';
import { firebaseAuth, onAuthStateChanged, signIn, signOutUser, useFirebase } from '@/lib/auth';
import { type DriveEntry, type DriveList, type FocusSession, type Item,
  type Resource, type Snapshot, type Tab, type DriveIndexed, type DriveSource, type DriveIndexResponse, type DriveScanResponse, duration,
  elapsedFocus, formatDate, kindLabels, localToday } from '@/lib/types';

type DriveStatus = { connected: boolean; configured: boolean };
const empty: Snapshot = {courses:[], weeks:[], items:[], resources:[], sessions:[], semesters:[]};
const pageNames: Record<Tab,string> = {today:'Today', courses:'Study Planner', tasks:'Tasks', focus:'Focus', library:'Resource Library'};
const tabs: {id:Tab; label:string; icon:typeof Home}[] = [
  {id:'today',label:'Today',icon:Home},{id:'courses',label:'Study',icon:BookOpen},
  {id:'tasks',label:'Tasks',icon:ListTodo},{id:'focus',label:'Focus',icon:Timer},
  {id:'library',label:'Library',icon:Folder}
];
function dateText(d: string|null|undefined) { return d ? formatDate(d) : '—'; }
export default function Page() {
  const [user,setUser] = useState<User|null>(null);
  const [authReady,setAuthReady] = useState(!useFirebase);
  const [tab,setTab] = useState<Tab>('today');
  const [theme,setTheme] = useState<'light'|'dark'>('light');
  const [data,setData] = useState<Snapshot>(empty);
  const [loading,setLoading] = useState(true);
  const [snapshotReady,setSnapshotReady] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [courseId,setCourseId] = useState('');
  const [weekNumber,setWeekNumber] = useState(1);
  const [now,setNow] = useState(Math.floor(Date.now()/1000));
  const [pdf,setPdf] = useState<{url:string;title:string;page:number;resourceId?:string;courseId?:string;weekNumber?:number}|null>(null);

  const [taskForm,setTaskForm] = useState(false);
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
    return onAuthStateChanged(firebaseAuth, u=>{setUser(u);setAuthReady(true);});
  },[]);
  useEffect(()=>{ const id=window.setInterval(()=>setNow(Math.floor(Date.now()/1000)),1000);return ()=>clearInterval(id);},[]);
  useEffect(()=>{
    const preference=window.localStorage.getItem('studyhub-theme');
    if(preference==='dark')setTheme('dark');
  },[]);
  const toggleTheme=()=>setTheme(previous=>{const next=previous==='light'?'dark':'light';window.localStorage.setItem('studyhub-theme',next);return next;});
  useEffect(()=>{
    const stored=window.localStorage.getItem('studyhub-focus-goal');
    if (stored && Number(stored)>=1 && Number(stored)<=80) setWeeklyGoal(Number(stored));
  },[]);

  const load = useCallback(async():Promise<boolean>=>{
    if (!authReady || (useFirebase && !user)) {setLoading(false);return false;}
    try {
      const snap=await api<Snapshot>('/api/snapshot',user);
      setData(snap);
      setSnapshotReady(true);
      setCourseId(previous=>snap.courses.some(c=>c.id===previous&&!c.archived)?previous:(snap.courses.find(c=>!c.archived)?.id||''));
      setLinkCourse(previous=>snap.courses.some(c=>c.id===previous&&!c.archived)?previous:(snap.courses.find(c=>!c.archived)?.id||''));
      setError('');
      return true;
    } catch(e) {setError(e instanceof Error ? e.message : 'Cannot connect to the API');return false;}
    finally {setLoading(false);}
  },[authReady,user]);
  useEffect(()=>{void load();},[load]);
  // Refresh after returning to the tab so changes from another device become visible.
  useEffect(()=>{
    const refreshOnReturn=()=>{if(document.visibilityState==='visible'&&!busy)void load();};
    document.addEventListener('visibilitychange',refreshOnReturn);
    return ()=>document.removeEventListener('visibilitychange',refreshOnReturn);
  },[load,busy]);

  const act = async(fn:()=>Promise<unknown>):Promise<boolean>=>{
    setBusy(true);setError('');
    try {
      await fn();
      const refreshed=await load();
      if(!refreshed)setError('Changes were saved, but the dashboard could not refresh. Use the refresh button to reload your data.');
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
  const greeting=overdue.length ? `${overdue.length} ${overdue.length===1?'task needs':'tasks need'} your attention.` :
    todayWork.length ? `${todayWork.length} ${todayWork.length===1?'priority':'priorities'} for today.` : 'Your day is yours to plan.';
  const greetingDetail=overdue.length ? 'Overdue work comes first. Clear or reschedule what matters, then return to studying.' :
    todayWork.length ? 'Your plan is ready. Make a little progress, one task at a time.' :
    'No work is due or planned for today. Pick up a course or plan something new.';
  const dateLabel=new Intl.DateTimeFormat('en-DK',{month:'short',day:'numeric',year:'numeric'}).format(new Date(now*1000));
  const active=data.sessions.find(s=>s.status==='running'||s.status==='paused');
  const currentWeekStart=useMemo(()=>{const d=new Date();d.setHours(0,0,0,0);const weekday=(d.getDay()+6)%7;d.setDate(d.getDate()-weekday);return Math.floor(d.getTime()/1000);},[today]);
  const weekSeconds=data.sessions.filter(s=>s.status==='finished'&&s.ended_at && s.ended_at>=currentWeekStart).reduce((n,s)=>n+(s.focus_seconds||0),0);
  const totalSeconds=data.sessions.filter(s=>s.status==='finished').reduce((n,s)=>n+(s.focus_seconds||0),0);
  const weekPct=Math.min(100,Math.round((weekSeconds/(weeklyGoal*3600))*100));
  const toggle=(i:Item)=>void act(async()=>{await api(`/api/items/${i.id}`,user,{method:'PATCH',body:{done:!i.done}});});
  const startFrom=(i?:Item)=>{
    // Personal tasks have no course; the selector still needs to retain their item ID.
    setFocusCourse(i?.course_id||'');setFocusItem(i?.id||'');
    setTab('focus');
  };
  const beginFocus=()=>void act(async()=>{
    const item=data.items.find(i=>i.id===focusItem);
    await api('/api/sessions/start',user,{method:'POST',body:{item_id:focusItem||null,course_id:focusCourse||null,week_number:item?.week_number||null,mode:focusMode}});
  });
  const sessionAction=(verb:'pause'|'resume')=>{if(!active)return;void act(async()=>{await api(`/api/sessions/${active.id}/${verb}`,user,{method:'POST'});});};
  const reviewFinish=()=>{if(!active)return;setFinishSeconds(String(Math.min(86400,elapsedFocus(active,now))));setFinishReview(true);};
  const finish=()=>{if(!active)return;void act(async()=>{
    await api(`/api/sessions/${active.id}/finish`,user,{method:'POST',body:{confirmed_seconds:Math.round(Number(finishSeconds))}});
    setFinishReview(false);
  });};
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
  const connectDrive=()=>void act(async()=>{const result=await api<{authorization_url:string}>('/api/drive/connect',user);window.location.assign(result.authorization_url);});
  const previewPdf=(fileId:string,title:string,resourceId?:string,lastPage=1)=>void act(async()=>{
    const url=await pdfBlob(`/api/drive/files/${fileId}/pdf`,user);
    if (pdf) URL.revokeObjectURL(pdf.url);
    const r=data.resources.find(entry=>entry.id===resourceId);
    setPdf({url,title,resourceId,courseId:r?.course_id,weekNumber:r?.week_number??weekNumber,page:lastPage||1});
  });
  const closePdf=()=>{if(pdf)URL.revokeObjectURL(pdf.url);setPdf(null);};
  const openTaskResource=(item:Item)=>{
    const r=data.resources.find(entry=>entry.id===item.resource_id);
    if(!r){setError('The linked document is no longer available. Check the Course Library.');return;}
    if(r.source==='drive'&&r.drive_file_id)previewPdf(r.drive_file_id,r.title,r.id,r.last_page);
    else if(r.url)window.open(r.url,'_blank','noopener,noreferrer');
  };

  const changePdfPage=(next:number)=>{
    if (!pdf) return;
    const page=Math.max(1,Math.min(20000,Math.floor(next)||1));
    setPdf(p=>p?{...p,page}:p);
    if (pdf.resourceId) void act(async()=>{
      await api(`/api/resources/${pdf.resourceId}/reading-position`,user,{method:'PATCH',body:{page}});
    });
  };
  const linkDriveFile=(file:DriveEntry)=>void act(async()=>{
    if(!linkCourse)throw new Error('Select a course before linking a PDF');
    await api('/api/resources',user,{method:'POST',body:{course_id:linkCourse,week_number:linkScope==='course'?null:linkWeek,title:file.name,kind:linkKind,source:'drive',drive_file_id:file.id,item_id:linkScope==='course'?null:(linkItem||null)}});
    await loadIndex();
  });
  const selectBackupFolder=()=>void act(async()=>{
    if(currentFolder.id==='root')throw new Error('Choose the Goodnotes backup folder, not the root of your Drive');
    const result=await api<{folder:DriveSource}>('/api/drive/source-folder',user,{method:'POST',body:{folder_id:currentFolder.id}});
    setSourceFolder(result.folder);setDriveIndex([]);
  });
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
    await api('/api/resources',user,{method:'POST',body:{course_id:suggestion.course_id,
      week_number:['textbook','handwritten'].includes(suggestion.kind)?null:suggestion.week_number,title:entry.name,kind:suggestion.kind,source:'drive',drive_file_id:entry.id}});
    await loadIndex();
  });
  const indexedVisible=driveIndex.filter(f=>indexFilter==='all'||(indexFilter==='unlinked'?f.links.length===0:(!f.suggestion&&f.links.length===0)));
  const currentFolder=folderPath.at(-1)!;
  useEffect(()=>{if(tab==='library'&&drive.connected&&driveFiles.length===0)void browseDrive(currentFolder.id);},[tab,drive.connected]); // initial browse only

  if (useFirebase&&!authReady) return <div className="boot"><LoaderCircle className="spin"/><p>Checking sign-in…</p></div>;
  if (useFirebase&&!user) return <main className="login-shell"><Card className="login-card"><span className="brand-mark"><GraduationCap/></span><h1>Your private Study Hub</h1><p>Courses, notes, deadlines and focus time in one workspace. Only your authorized account can access the deployed app.</p><button className="btn primary" onClick={()=>void signIn()}>Sign in with Google</button></Card></main>;

  return <div className={`app-shell ${theme==='dark'?'theme-dark':''}`}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><GraduationCap size={21}/></span><div><strong>Study Hub</strong><small>Personal workspace</small></div></div>
      <div className="nav-label">MY WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className={'nav-btn '+(tab===t.id?'current':'')}><t.icon size={18}/>{t.label}{t.id==='tasks'&&openTasks.length>0&&<span className="nav-count">{openTasks.length}</span>}</button>)}</nav>
      <div className="sidebar-spacer"/>
      <div className="sidebar-bottom"><div className="privacy"><span className="live-dot"/><span>{useFirebase?'Private Firebase account':'Local private development'}</span></div><p>RepLap stays in its own project.</p><button className="theme-toggle" onClick={toggleTheme}>{theme==='light'?<Moon size={15}/>:<Sun size={15}/>} {theme==='light'?'Switch to dark theme':'Switch to light theme'}</button>{useFirebase&&<button className="link-btn" onClick={()=>void signOutUser()}>Sign out</button>}</div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb"><Sparkles size={16}/> PERSONAL HUB <span>/</span> <strong>{pageNames[tab]}</strong></div><div className="topbar-right"><span className="topbar-date">{dateLabel}</span><button className="topbar-theme" disabled={loading||busy} aria-label="Refresh study data" title="Refresh study data" onClick={()=>{setLoading(true);void load();}}>{loading?<LoaderCircle size={17} className="spin"/>:<RotateCcw size={17}/>}</button><button className="topbar-theme" aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'} title={theme==='light'?'Dark theme':'Light theme'} onClick={toggleTheme}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button><button className="topbar-focus" onClick={()=>setTab('focus')}><Zap size={15}/> Quick focus</button><span className="avatar">SH</span></div></header>
      <main className="page-content">
        {error&&<div className="alert" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><X size={17}/></button></div>}
        {loading?<div className="loading-state"><LoaderCircle className="spin"/> Loading your workspace…</div>:!snapshotReady?<Card className="load-error"><SectionTitle title="Could not load your Study Hub"/><p className="muted">Your data has not been loaded. Check your connection and retry; an empty dashboard here would be misleading.</p><button className="btn primary" onClick={()=>{setLoading(true);void load();}}><RotateCcw size={16}/> Retry loading</button></Card>:<>
          {tab==='today'&&<>
            <div className="page-heading"><div><span className="eyebrow"><Sparkles size={13}/> YOUR DAILY WORKSPACE</span><h1>Make today count.</h1><p>Everything you need to move forward, in one calm space.</p></div><button className="btn secondary" onClick={()=>{setTab('tasks');setTaskForm(true);}}><Plus size={16}/> Quick task</button></div>
            <div className={'welcome-hero'+(overdue.length?' needs-attention':'')}><div className="hero-copy"><span className="hero-label">{overdue.length?<AlertTriangle size={15}/>:<Sparkles size={15}/>} YOUR DAILY BRIEF · {dateLabel}</span><h2>{greeting}</h2><p>{greetingDetail}</p><div className="hero-actions"><button className="btn hero-primary" onClick={()=>setTab(overdue.length?'tasks':'courses')}>{overdue.length?<ListTodo size={15}/>:<BookOpen size={15}/>} {overdue.length?'Review priorities':selectedCourse?'Continue studying':'Open Study Planner'}</button><button className="btn hero-secondary" onClick={()=>setTab('tasks')}><CalendarDays size={15}/> View my plan</button></div></div><div className="hero-decoration" aria-hidden="true"><span className="hero-orb">{overdue.length?<AlertTriangle size={55}/>:<BookOpen size={57}/>}</span><span className="hero-float"><Sparkles size={27}/></span></div></div>
            <div className="stats-grid">
              <Card className="stat"><span className="stat-icon"><ListTodo/></span><span>Open tasks</span><strong>{openTasks.length}</strong><small>{todayWork.length} to handle today · {plannedToday.length} planned today</small></Card>
              <Card className="stat"><span className="stat-icon"><Clock3/></span><span>Focus this week</span><strong>{(weekSeconds/3600).toFixed(1)}<em>h</em></strong><small>Target: {weeklyGoal} hours · saved on this device</small></Card>
              <Card className={'stat'+(overdue.length?' stat-alert':'')}><span className="stat-icon">{overdue.length?<AlertTriangle/>:<CalendarDays/>}</span><span>Upcoming deadlines</span><strong>{upcoming.length}</strong><small>{overdue.length?<span className="stat-alert-label"><AlertTriangle size={13}/> {overdue.length} overdue · action needed</span>:'No overdue work'}</small></Card>
            </div>
            <div className="two-col-layout">
              <div className="stack">
                <Card><SectionTitle title="Today's priorities" aside={<button className="text-button" onClick={()=>setTab('tasks')}>All tasks <ArrowRight size={14}/></button>}/>
                  {todayWork.length?todayWork.slice(0,6).map(i=><div className={'task-row'+(isOverdue(i,today)?' task-overdue':'')} key={i.id}><input aria-label={`Complete ${i.title}`} type="checkbox" checked={i.done} disabled={busy} onChange={()=>toggle(i)}/><div className="task-content"><strong>{i.title}</strong><small>{i.course_id?(data.courses.find(c=>c.id===i.course_id)?.code||'Study'):'Personal'} · {kindLabels[i.kind]}{i.due_date&&i.due_date<=today?` · Due ${dateText(i.due_date)}`:i.planned_date&&i.planned_date<today?` · Planned ${dateText(i.planned_date)}`:''}</small></div>{isOverdue(i,today)&&<Badge tone="danger"><AlertTriangle size={12}/> Overdue</Badge>}{i.resource_id&&<button className="icon-btn" disabled={busy} aria-label={`Open resource for ${i.title}`} title="Open linked notes or textbook" onClick={()=>openTaskResource(i)}><BookOpen size={16}/></button>}<button className="icon-btn" title={`Focus on ${i.title}`} aria-label={`Focus on ${i.title}`} disabled={busy} onClick={()=>startFrom(i)}><Timer size={16}/></button></div>):<EmptyState icon={<CheckCircle2 size={24}/>} title="A clear day" detail="No work due or planned for today. Plan a task or start a focus session."/>}
                  {todayWork.length>6&&<button className="text-button" onClick={()=>setTab('tasks')}>View {todayWork.length-6} more in Tasks <ArrowRight size={14}/></button>}
                </Card>
                <Card><SectionTitle title="Upcoming deadlines" aside={<Badge>{upcoming.length} open</Badge>}/>
                  {upcoming.slice(0,4).map(i=><div className="deadline-row" key={i.id}><span className="date-tile">{i.due_date?.slice(8)}</span><div><strong>{i.title}</strong><small>{data.courses.find(c=>c.id===i.course_id)?.code||'Personal'} · Due {dateText(i.due_date)}</small></div></div>)}
                  {!upcoming.length&&<p className="muted">No upcoming deadlines yet.</p>}
                </Card>
              </div>
              <div className="stack">
                <Card className="accent-card"><div className="overline">YOUR COURSE WORKSPACE</div><div className="accent-icon"><BookOpen size={25}/></div><h2>{selectedCourse?.title||'Start your first course'}</h2><p>{selectedCourse?`${selectedCourse.code} · Week ${weekNumber}${selectedWeek?` · ${selectedWeek.title}`:''}`:'Add your DTU courses and weekly topics to organize all your learning materials.'}</p><button className="btn primary" onClick={()=>{if(selectedCourse){setCourseId(selectedCourse.id);setWeekNumber(Math.min(weekNumber,selectedCourse.week_count));}setTab('courses');}} aria-label={selectedCourse?`Open ${selectedCourse.title} in Study Planner`:'Set up a course'}>{selectedCourse?'Open course':'Set up a course'} <ArrowRight size={16}/></button></Card>
                <Card><SectionTitle title="Weekly focus goal" aside={<span className="quiet-number">{Math.round(weekSeconds/60)} / {weeklyGoal*60} min</span>}/><div className="progress-track"><div style={{width:`${weekPct}%`}}/></div><div className="goal-footer"><span>{weekPct}% of your goal</span><label>Goal <input type="number" min={1} max={80} value={weeklyGoal} onChange={e=>{const n=Math.max(1,Math.min(80,Number(e.target.value)||1));setWeeklyGoal(n);localStorage.setItem('studyhub-focus-goal',String(n));}}/> h / week</label></div></Card>
              </div>
            </div>
          </>}

          {tab==='courses'&&<CoursePlanner data={data} user={user} busy={busy}
            courseId={courseId} weekNumber={weekNumber} selectCourse={setCourseId} selectWeek={setWeekNumber}
            run={act} toggleItem={toggle} focusOn={startFrom}
            openResource={r=>{if(r.source==='drive'&&r.drive_file_id)previewPdf(r.drive_file_id,r.title,r.id,r.last_page);else if(r.url)window.open(r.url,'_blank','noopener,noreferrer');}}
            openDrive={(id,week,kind,scope)=>{setLinkCourse(id);setLinkWeek(week);setLinkScope(scope);setLinkKind(kind);setLinkItem('');setTab('library');}}
          />}

          {tab==='tasks'&&<TasksPlanner items={tasks} courses={data.courses} user={user} busy={busy}
            run={act} onToggle={toggle} onFocus={startFrom} onOpenResource={openTaskResource} createOpen={taskForm} setCreateOpen={setTaskForm}/>}

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
                {drive.connected?<div className="connection-status"><span className="live-dot"/> Connected privately <button className="text-button" onClick={()=>{if(confirm('Disconnect Google Drive and erase the local folder index? Existing linked resources will remain.'))void act(async()=>{await api('/api/drive/disconnect',user,{method:'DELETE'});setDrive({connected:false,configured:drive.configured});setDriveFiles([]);setSourceFolder(null);setDriveIndex([]);});}}>Disconnect</button></div>:<button className="btn primary" disabled={!drive.configured||busy} onClick={connectDrive}><Cloud size={16}/> Connect my Drive</button>}
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
