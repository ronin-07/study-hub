'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3,
  Cloud, ExternalLink, FileText, Folder, GraduationCap, Home, Link2, ListTodo, LoaderCircle, FolderCheck, ScanSearch,
  Pause, Play, Plus, RotateCcw, Search, Square, Timer, Trash2, X, Sparkles, Sun, Moon, Zap, Target, Layers3
} from 'lucide-react';
import { api, pdfBlob } from '@/lib/api';
import { firebaseAuth, onAuthStateChanged, signIn, signOutUser, useFirebase } from '@/lib/auth';
import { type Course, type DriveEntry, type DriveList, type FocusSession, type Item,
  type Resource, type Snapshot, type Tab, type Week, type DriveIndexed, type DriveSource, type DriveIndexResponse, type DriveScanResponse, duration,
  elapsedFocus, formatDate, kindLabels, localToday } from '@/lib/types';

type ItemKind = import('@/lib/types').Kind;
type DriveStatus = { connected: boolean; configured: boolean };
const empty: Snapshot = {courses:[], weeks:[], items:[], resources:[], sessions:[]};
const pageNames: Record<Tab,string> = {today:'Today', courses:'Study Planner', tasks:'Tasks', focus:'Focus', library:'Resource Library'};
const itemsForWeek = (data: Snapshot, courseId: string, week: number) => data.items.filter(i=>i.course_id===courseId && i.week_number===week);
const tabs: {id:Tab; label:string; icon:typeof Home}[] = [
  {id:'today',label:'Today',icon:Home},{id:'courses',label:'Study',icon:BookOpen},
  {id:'tasks',label:'Tasks',icon:ListTodo},{id:'focus',label:'Focus',icon:Timer},
  {id:'library',label:'Library',icon:Folder}
];
function dateText(d: string|null|undefined) { return d ? formatDate(d) : '—'; }
function Card({children,className=''}:{children:ReactNode;className?:string}) { return <section className={'card '+className}>{children}</section>; }
function EmptyState({icon, title, detail}:{icon:ReactNode;title:string;detail:string}) {return <div className="empty-state">{icon}<strong>{title}</strong><p>{detail}</p></div>;}
function SectionTitle({title,aside}:{title:string;aside?:ReactNode}) {return <div className="section-title"><h3>{title}</h3>{aside}</div>;}
function Badge({children,tone='muted'}:{children:ReactNode;tone?:'muted'|'good'|'warning'|'danger'}) {return <span className={'badge '+tone}>{children}</span>;}
function DayStatus({i}:{i:Item}) {return <div className="item-dates">{i.planned_date && <span><CalendarDays size={13}/> Planned {formatDate(i.planned_date)}</span>}{i.due_date && <span><Clock3 size={13}/> Due {formatDate(i.due_date)}</span>}</div>;}
function FormRow({label,children}:{label:string;children:ReactNode}) {return <label className="form-row"><span>{label}</span>{children}</label>;}

export default function Page() {
  const [user,setUser] = useState<User|null>(null);
  const [authReady,setAuthReady] = useState(!useFirebase);
  const [tab,setTab] = useState<Tab>('today');
  const [theme,setTheme] = useState<'light'|'dark'>('light');
  const [dateLabel,setDateLabel] = useState('Today');
  const [data,setData] = useState<Snapshot>(empty);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [courseId,setCourseId] = useState('');
  const [weekNumber,setWeekNumber] = useState(1);
  const [now,setNow] = useState(Math.floor(Date.now()/1000));
  const [pdf,setPdf] = useState<{url:string;title:string;page:number;resourceId?:string}|null>(null);
  const [pdfPageDraft,setPdfPageDraft] = useState('1');

  const [courseForm,setCourseForm] = useState(false);
  const [weekForm,setWeekForm] = useState(false);
  const [itemForm,setItemForm] = useState(false);
  const [resourceForm,setResourceForm] = useState(false);
  const [taskForm,setTaskForm] = useState(false);
  const [taskFilter,setTaskFilter] = useState<'today'|'upcoming'|'completed'>('today');
  const [courseDraft,setCourseDraft] = useState({code:'',title:'',semester:'Autumn 2026',week_count:13});
  const [weekDraft,setWeekDraft] = useState({title:'',objectives:''});
  const [itemDraft,setItemDraft] = useState({title:'',kind:'lecture' as ItemKind,is_task:false, planned_date:'',due_date:'',priority:'medium',notes:''});
  const [taskDraft,setTaskDraft] = useState({title:'', planned_date:localToday(), due_date:'',priority:'medium'});
  const [resourceDraft,setResourceDraft] = useState({title:'',url:'',source:'dtu' as 'dtu'|'link',kind:'slides' as Resource['kind']});

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
  const [linkKind,setLinkKind] = useState<Resource['kind']>('handwritten');

  useEffect(()=>{
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, u=>{setUser(u);setAuthReady(true);});
  },[]);
  useEffect(()=>{ const id=window.setInterval(()=>setNow(Math.floor(Date.now()/1000)),1000);return ()=>clearInterval(id);},[]);
  useEffect(()=>{
    setDateLabel(new Intl.DateTimeFormat('en-DK',{month:'short',day:'numeric',year:'numeric'}).format(new Date()));
    const preference=window.localStorage.getItem('studyhub-theme');
    if(preference==='dark')setTheme('dark');
  },[]);
  const toggleTheme=()=>setTheme(previous=>{const next=previous==='light'?'dark':'light';window.localStorage.setItem('studyhub-theme',next);return next;});
  useEffect(()=>{
    const stored=window.localStorage.getItem('studyhub-focus-goal');
    if (stored && Number(stored)>=1 && Number(stored)<=80) setWeeklyGoal(Number(stored));
  },[]);

  const load = useCallback(async()=>{
    if (!authReady || (useFirebase && !user)) {setLoading(false);return;}
    try {
      const snap=await api<Snapshot>('/api/snapshot',user);
      setData(snap);
      setCourseId(previous=>previous || snap.courses[0]?.id || '');
      setLinkCourse(previous=>previous || snap.courses[0]?.id || '');
      setError('');
    } catch(e) {setError(e instanceof Error ? e.message : 'Cannot connect to the API');}
    finally {setLoading(false);}
  },[authReady,user]);
  useEffect(()=>{void load();},[load]);

  const act = async(fn:()=>Promise<unknown>)=>{
    setBusy(true);setError('');
    try {await fn();await load();} catch(e) {setError(e instanceof Error?e.message:'Action failed');}
    finally {setBusy(false);}
  };
  const selectedCourse = data.courses.find(c=>c.id===courseId);
  const selectedWeek = data.weeks.find(w=>w.course_id===courseId && w.number===weekNumber);
  const selectedItems = itemsForWeek(data,courseId,weekNumber);
  const selectedResources = data.resources.filter(r=>r.course_id===courseId&&r.week_number===weekNumber);
  const tasks = data.items.filter(i=>i.is_task);
  const today=localToday();
  const openTasks = tasks.filter(i=>!i.done);
  const plannedToday=openTasks.filter(i=>i.planned_date===today);
  const overdue=openTasks.filter(i=>i.due_date && i.due_date < today);
  const upcoming=openTasks.filter(i=>i.due_date).sort((a,b)=>(a.due_date||'').localeCompare(b.due_date||''));
  const active=data.sessions.find(s=>s.status==='running'||s.status==='paused');
  const currentWeekStart=useMemo(()=>{const d=new Date();d.setHours(0,0,0,0);const weekday=(d.getDay()+6)%7;d.setDate(d.getDate()-weekday);return Math.floor(d.getTime()/1000);},[today]);
  const weekSeconds=data.sessions.filter(s=>s.status==='finished'&&s.ended_at && s.ended_at>=currentWeekStart).reduce((n,s)=>n+(s.focus_seconds||0),0);
  const totalSeconds=data.sessions.filter(s=>s.status==='finished').reduce((n,s)=>n+(s.focus_seconds||0),0);
  const weekPct=Math.min(100,Math.round((weekSeconds/(weeklyGoal*3600))*100));
  const doneCount=selectedItems.filter(i=>i.done).length;
  const progress=selectedItems.length?Math.round(doneCount*100/selectedItems.length):0;
  const listForTasks = taskFilter==='today' ? tasks.filter(i=>i.planned_date===today || (!i.done&&!!i.due_date&&i.due_date<today)) : taskFilter==='completed' ? tasks.filter(i=>i.done) : tasks.filter(i=>!i.done);
  const sortedTasks=[...listForTasks].sort((a,b)=>(a.due_date||a.planned_date||'9999').localeCompare(b.due_date||b.planned_date||'9999'));

  const newCourse=(e:FormEvent)=>{e.preventDefault();void act(async()=>{
    const c=await api<Course>('/api/courses',user,{method:'POST',body:courseDraft});
    setCourseId(c.id);setWeekNumber(1);setCourseForm(false);setCourseDraft({code:'',title:'',semester:'Autumn 2026',week_count:13});
  });};
  const newWeek=(e:FormEvent)=>{e.preventDefault();void act(async()=>{
    await api('/api/weeks',user,{method:'POST',body:{course_id:courseId,number:weekNumber,...weekDraft}});
    setWeekForm(false);setWeekDraft({title:'',objectives:''});
  });};
  const newItem=(e:FormEvent)=>{e.preventDefault();void act(async()=>{
    await api('/api/items',user,{method:'POST',body:{...itemDraft,course_id:courseId,week_number:weekNumber,is_task:itemDraft.kind==='assignment'||!!itemDraft.planned_date||itemDraft.is_task,planned_date:itemDraft.planned_date||null,due_date:itemDraft.due_date||null}});
    setItemForm(false);setItemDraft({title:'',kind:'lecture',is_task:false,planned_date:'',due_date:'',priority:'medium',notes:''});
  });};
  const newTask=(e:FormEvent)=>{e.preventDefault();void act(async()=>{
    await api('/api/items',user,{method:'POST',body:{...taskDraft,kind:'personal',planned_date:taskDraft.planned_date||null,due_date:taskDraft.due_date||null}});
    setTaskForm(false);setTaskDraft({title:'',planned_date:today,due_date:'',priority:'medium'});
  });};
  const newResource=(e:FormEvent)=>{e.preventDefault();void act(async()=>{
    await api('/api/resources',user,{method:'POST',body:{...resourceDraft,course_id:courseId,week_number:weekNumber}});
    setResourceForm(false);setResourceDraft({title:'',url:'',source:'dtu',kind:'slides'});
  });};
  const toggle=(i:Item)=>void act(async()=>{await api(`/api/items/${i.id}`,user,{method:'PATCH',body:{done:!i.done}});});
  const startFrom=(i?:Item)=>{
    setFocusItem(i?.id||'');setFocusCourse(i?.course_id||'');
    setTab('focus');
  };
  const beginFocus=()=>void act(async()=>{
    const item=data.items.find(i=>i.id===focusItem);
    await api('/api/sessions/start',user,{method:'POST',body:{item_id:focusItem||null,course_id:focusCourse||null,week_number:item?.week_number||null,mode:focusMode}});
  });
  const sessionAction=(verb:'pause'|'resume')=>{if(!active)return;void act(async()=>{await api(`/api/sessions/${active.id}/${verb}`,user,{method:'POST'});});};
  const reviewFinish=()=>{if(!active)return;setFinishSeconds(String(elapsedFocus(active,now)));setFinishReview(true);};
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
    setPdf({url,title,resourceId,page:lastPage||1});
    setPdfPageDraft(String(lastPage||1));
  });
  const closePdf=()=>{if(pdf)URL.revokeObjectURL(pdf.url);setPdf(null);};
  const changePdfPage=(next:number)=>{
    if (!pdf) return;
    const page=Math.max(1,Math.min(20000,Math.floor(next)||1));
    setPdf(p=>p?{...p,page}:p);
    setPdfPageDraft(String(page));
    if (pdf.resourceId) void act(async()=>{
      await api(`/api/resources/${pdf.resourceId}/reading-position`,user,{method:'PATCH',body:{page}});
    });
  };
  const linkDriveFile=(file:DriveEntry)=>void act(async()=>{
    if(!linkCourse)throw new Error('Select a course before linking a PDF');
    await api('/api/resources',user,{method:'POST',body:{course_id:linkCourse,week_number:linkWeek,title:file.name,kind:linkKind,source:'drive',drive_file_id:file.id}});
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
      week_number:suggestion.week_number,title:entry.name,kind:suggestion.kind,source:'drive',drive_file_id:entry.id}});
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
      <div className="sidebar-focus"><span className="sidebar-focus-kicker">YOUR MOMENTUM</span><strong>Make space for deep work.</strong><p>A little focus today adds up.</p><button onClick={()=>setTab('focus')}><Play size={14} fill="currentColor"/> Start focusing</button></div>
      <div className="sidebar-bottom"><div className="privacy"><span className="live-dot"/><span>{useFirebase?'Private Firebase account':'Local private development'}</span></div><p>RepLap stays in its own project.</p><button className="theme-toggle" onClick={toggleTheme}>{theme==='light'?<Moon size={15}/>:<Sun size={15}/>} {theme==='light'?'Switch to dark theme':'Switch to light theme'}</button>{useFirebase&&<button className="link-btn" onClick={()=>void signOutUser()}>Sign out</button>}</div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb"><Sparkles size={16}/> PERSONAL HUB <span>/</span> <strong>{pageNames[tab]}</strong></div><div className="topbar-right"><span className="topbar-date">{dateLabel}</span><button className="topbar-theme" aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'} title={theme==='light'?'Dark theme':'Light theme'} onClick={toggleTheme}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button><button className="topbar-focus" onClick={()=>setTab('focus')}><Zap size={15}/> Quick focus</button><span className="avatar">SH</span></div></header>
      <main className="page-content">
        {error&&<div className="alert" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><X size={17}/></button></div>}
        {loading?<div className="loading-state"><LoaderCircle className="spin"/> Loading your workspace…</div>:<>
          {tab==='today'&&<>
            <div className="page-heading"><div><span className="eyebrow"><Sparkles size={13}/> YOUR DAILY WORKSPACE</span><h1>Make today count.</h1><p>Everything you need to move forward, in one calm space.</p></div><button className="btn secondary" onClick={()=>{setTab('tasks');setTaskForm(true);}}><Plus size={16}/> Quick task</button></div>
            <div className="welcome-hero"><div className="hero-copy"><span className="hero-label"><Sparkles size={15}/> A FRESH PAGE, EVERY DAY</span><h2>Small steps. Big progress.</h2><p>Pick a priority, settle in, and find your flow. You've got this.</p><div className="hero-actions"><button className="btn hero-primary" onClick={()=>setTab('focus')}><Play size={15} fill="currentColor"/> Enter focus mode</button><button className="btn hero-secondary" onClick={()=>setTab('courses')}><BookOpen size={15}/> My courses</button></div></div><div className="hero-decoration" aria-hidden="true"><span className="hero-orb"><BookOpen size={57}/></span><span className="hero-float"><Sparkles size={27}/></span></div></div>
            <div className="stats-grid">
              <Card className="stat"><span className="stat-icon"><ListTodo/></span><span>Open tasks</span><strong>{openTasks.length}</strong><small>{plannedToday.length} planned today</small></Card>
              <Card className="stat"><span className="stat-icon"><Clock3/></span><span>Focus this week</span><strong>{(weekSeconds/3600).toFixed(1)}<em>h</em></strong><small>Target: {weeklyGoal} hours</small></Card>
              <Card className="stat"><span className="stat-icon"><CalendarDays/></span><span>Upcoming deadlines</span><strong>{upcoming.length}</strong><small>{overdue.length?`${overdue.length} overdue`:'All deadlines on track'}</small></Card>
            </div>
            <div className="two-col-layout">
              <div className="stack">
                <Card><SectionTitle title="Today's priorities" aside={<button className="text-button" onClick={()=>setTab('tasks')}>All tasks <ArrowRight size={14}/></button>}/>
                  {plannedToday.length||overdue.length? [...new Map([...overdue,...plannedToday].map(i=>[i.id,i])).values()].map(i=><div className="task-row" key={i.id}><input aria-label={`Complete ${i.title}`} type="checkbox" checked={i.done} onChange={()=>toggle(i)}/><div className="task-content"><strong>{i.title}</strong><small>{i.course_id?(data.courses.find(c=>c.id===i.course_id)?.code||'Study'):'Personal'} · {kindLabels[i.kind]}</small></div>{i.course_id&&<button className="icon-btn" title="Start focus" onClick={()=>startFrom(i)}><Timer size={16}/></button>}</div>):<EmptyState icon={<CheckCircle2 size={24}/>} title="A clear day" detail="Plan a task or start a free focus session."/>}
                </Card>
                <Card><SectionTitle title="Upcoming deadlines" aside={<Badge>{upcoming.length} open</Badge>}/>
                  {upcoming.slice(0,4).map(i=><div className="deadline-row" key={i.id}><span className="date-tile">{i.due_date?.slice(8)}</span><div><strong>{i.title}</strong><small>{data.courses.find(c=>c.id===i.course_id)?.code||'Personal'} · Due {dateText(i.due_date)}</small></div>{i.due_date&&i.due_date<today&&<Badge tone="danger">Overdue</Badge>}</div>)}
                  {!upcoming.length&&<p className="muted">No upcoming deadlines yet.</p>}
                </Card>
              </div>
              <div className="stack">
                <Card className="accent-card"><div className="overline">PICK UP WHERE YOU LEFT OFF</div><div className="accent-icon"><BookOpen size={25}/></div><h2>{selectedCourse?.title||'Start your first course'}</h2><p>{selectedCourse?`${selectedCourse.code} · Week ${weekNumber}${selectedWeek?` · ${selectedWeek.title}`:''}`:'Add your DTU courses and weekly topics to organize all your learning materials.'}</p><button className="btn primary" onClick={()=>setTab('courses')}>{selectedCourse?'Open week planner':'Set up a course'} <ArrowRight size={16}/></button></Card>
                <Card><SectionTitle title="Weekly focus goal" aside={<span className="quiet-number">{Math.round(weekSeconds/60)} / {weeklyGoal*60} min</span>}/><div className="progress-track"><div style={{width:`${weekPct}%`}}/></div><div className="goal-footer"><span>{weekPct}% of your goal</span><label>Goal <input type="number" min={1} max={80} value={weeklyGoal} onChange={e=>{const n=Math.max(1,Math.min(80,Number(e.target.value)||1));setWeeklyGoal(n);localStorage.setItem('studyhub-focus-goal',String(n));}}/> h / week</label></div><button className="btn secondary full" onClick={()=>setTab('focus')}><Play size={15}/> Start focus session</button></Card>
              </div>
            </div>
          </>}

          {tab==='courses'&&<>
            <div className="page-heading"><div><span className="eyebrow"><Layers3 size={13}/> ACADEMIC PLANNER</span><h1>Your learning space.</h1><p>One beautiful place for every course, week and resource.</p></div><button className="btn primary" onClick={()=>setCourseForm(!courseForm)}><Plus size={17}/> Add course</button></div>
            {courseForm&&<Card className="form-card"><h3>Create a course</h3><form onSubmit={newCourse} className="form-grid"><FormRow label="Course code"><input required value={courseDraft.code} onChange={e=>setCourseDraft(p=>({...p,code:e.target.value}))} placeholder="02516"/></FormRow><FormRow label="Course title"><input required value={courseDraft.title} onChange={e=>setCourseDraft(p=>({...p,title:e.target.value}))} placeholder="Image Analysis & Computer Vision"/></FormRow><FormRow label="Semester"><input value={courseDraft.semester} onChange={e=>setCourseDraft(p=>({...p,semester:e.target.value}))}/></FormRow><FormRow label="Teaching weeks"><input type="number" min={1} max={30} value={courseDraft.week_count} onChange={e=>setCourseDraft(p=>({...p,week_count:Number(e.target.value)}))}/></FormRow><div className="form-actions"><button className="btn secondary" type="button" onClick={()=>setCourseForm(false)}>Cancel</button><button className="btn primary" disabled={busy}>Save course</button></div></form></Card>}
            {data.courses.length===0?<Card><EmptyState icon={<GraduationCap size={32}/>} title="Create your first DTU course" detail="Add the course code, semester, and teaching-week count. You can then link Goodnotes PDFs, slides and reading assignments."/></Card>:<>
              <div className="course-pills">{data.courses.map(c=><button className={'course-pill '+(courseId===c.id?'active':'')} key={c.id} onClick={()=>{setCourseId(c.id);setWeekNumber(1);}}><span>{c.code}</span><small>{c.title}</small></button>)}</div>
              {selectedCourse&&<div className="two-col-layout course-layout"><div className="stack">
                <Card><div className="course-heading"><div><span className="eyebrow">{selectedCourse.semester}</span><h2>{selectedCourse.title}</h2><p>{selectedCourse.code} · {selectedCourse.week_count} teaching weeks</p></div><GraduationCap size={30}/></div>
                  <div className="week-tools"><FormRow label="Teaching week"><select value={weekNumber} onChange={e=>setWeekNumber(Number(e.target.value))}>{Array.from({length:selectedCourse.week_count},(_,n)=><option key={n+1} value={n+1}>Week {n+1}</option>)}</select></FormRow><button className="btn secondary" onClick={()=>setWeekForm(!weekForm)}><Plus size={15}/> {selectedWeek?'New week':'Set up week'}</button></div>
                  {selectedWeek?<><h3 className="week-title">Week {weekNumber}: {selectedWeek.title}</h3>{selectedWeek.objectives&&<p className="muted">{selectedWeek.objectives}</p>}<div className="progress-heading"><span>Weekly completion</span><strong>{doneCount}/{selectedItems.length} items</strong></div><div className="progress-track"><div style={{width:`${progress}%`}}/></div></>:<div className="subtle-notice">No topic set for Week {weekNumber}. You can still add study items and resources.</div>}
                  {weekForm&&<form className="mini-form" onSubmit={newWeek}><FormRow label={`Topic for Week ${weekNumber}`}><input required value={weekDraft.title} placeholder="e.g. Multiclass segmentation" onChange={e=>setWeekDraft(p=>({...p,title:e.target.value}))}/></FormRow><FormRow label="Learning objectives (optional)"><textarea rows={2} value={weekDraft.objectives} onChange={e=>setWeekDraft(p=>({...p,objectives:e.target.value}))}/></FormRow><button className="btn primary" disabled={busy||!!selectedWeek}>Save week</button>{selectedWeek&&<small className="muted">This week already exists; editing topics will be added in a later milestone.</small>}</form>}
                </Card>
                <Card><SectionTitle title="Learning checklist" aside={<button className="btn secondary small" onClick={()=>setItemForm(!itemForm)}><Plus size={14}/> Add item</button>}/>
                  {itemForm&&<form className="mini-form" onSubmit={newItem}><FormRow label="Title"><input required value={itemDraft.title} onChange={e=>setItemDraft(p=>({...p,title:e.target.value}))} placeholder="Read lecture 10 slides"/></FormRow><div className="form-grid"><FormRow label="Activity type"><select value={itemDraft.kind} onChange={e=>setItemDraft(p=>({...p,kind:e.target.value as ItemKind}))}>{(['lecture','notes','reading','revision','assignment'] as const).map(k=><option key={k} value={k}>{kindLabels[k]}</option>)}</select></FormRow><FormRow label="Priority"><select value={itemDraft.priority} onChange={e=>setItemDraft(p=>({...p,priority:e.target.value}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></FormRow><FormRow label="Planned study date"><input type="date" value={itemDraft.planned_date} onChange={e=>setItemDraft(p=>({...p,planned_date:e.target.value}))}/></FormRow><FormRow label="Due date"><input type="date" value={itemDraft.due_date} onChange={e=>setItemDraft(p=>({...p,due_date:e.target.value}))}/></FormRow></div><label className="inline-check"><input type="checkbox" checked={itemDraft.kind==='assignment'||itemDraft.is_task} disabled={itemDraft.kind==='assignment'} onChange={e=>setItemDraft(p=>({...p,is_task:e.target.checked}))}/> Also show in Tasks</label><div className="form-actions"><button className="btn secondary" type="button" onClick={()=>setItemForm(false)}>Cancel</button><button className="btn primary" disabled={busy}>Add activity</button></div></form>}
                  {selectedItems.length ? selectedItems.map(i=><div className="study-row" key={i.id}><input type="checkbox" aria-label={`Complete ${i.title}`} checked={i.done} onChange={()=>toggle(i)}/><div className="task-content"><strong className={i.done?'complete':''}>{i.title}</strong><div className="inline-meta"><Badge>{kindLabels[i.kind]}</Badge>{i.is_task&&<Badge tone="good">Linked task</Badge>}{i.due_date&&<small>Due {formatDate(i.due_date)}</small>}</div></div><button className="icon-btn" title="Start focus on this item" onClick={()=>startFrom(i)}><Timer size={17}/></button><button className="icon-btn danger-hover" title="Delete item" onClick={()=>{if(confirm(`Delete “${i.title}”?`))void act(async()=>api(`/api/items/${i.id}`,user,{method:'DELETE'}));}}><Trash2 size={15}/></button></div>):<EmptyState icon={<CheckCircle2 size={23}/>} title="No study activities yet" detail="Add lecture slides, reading, notes, revision and assignments. Assignments automatically appear in Tasks."/>}
                </Card>
              </div><div className="stack">
                <Card><SectionTitle title="Week resources" aside={<button className="btn secondary small" onClick={()=>setResourceForm(!resourceForm)}><Plus size={14}/> Add link</button>}/><p className="muted compact">Original slides, annotated copies, handwritten notes and textbook PDFs belong together here.</p>
                  {resourceForm&&<form className="mini-form" onSubmit={newResource}><FormRow label="Resource title"><input required value={resourceDraft.title} onChange={e=>setResourceDraft(p=>({...p,title:e.target.value}))}/></FormRow><FormRow label="URL (DTU Learn or other HTTPS link)"><input type="url" required placeholder="https://..." value={resourceDraft.url} onChange={e=>setResourceDraft(p=>({...p,url:e.target.value}))}/></FormRow><div className="form-grid"><FormRow label="Source"><select value={resourceDraft.source} onChange={e=>setResourceDraft(p=>({...p,source:e.target.value as 'dtu'|'link'}))}><option value="dtu">DTU Learn</option><option value="link">External link</option></select></FormRow><FormRow label="Type"><select value={resourceDraft.kind} onChange={e=>setResourceDraft(p=>({...p,kind:e.target.value as Resource['kind']}))}>{(['slides','annotated','handwritten','textbook','other'] as const).map(k=><option key={k}>{k}</option>)}</select></FormRow></div><button className="btn primary" disabled={busy}>Link resource</button></form>}
                  {selectedResources.map(r=><div className="resource-row" key={r.id}><div className="resource-icon"><FileText size={18}/></div><div className="task-content"><strong>{r.title}</strong><small>{r.kind} · {r.source==='drive'?'Goodnotes / Google Drive':r.source==='dtu'?'DTU Learn':'External link'}</small></div><button className="icon-btn" title="Open resource" onClick={()=>{if(r.source==='drive'&&r.drive_file_id)previewPdf(r.drive_file_id,r.title,r.id,r.last_page);else if(r.url)window.open(r.url,'_blank','noopener,noreferrer');}}>{r.source==='drive'?<BookOpen size={17}/>:<ExternalLink size={17}/>}</button><button className="icon-btn danger-hover" title="Remove resource" onClick={()=>{if(confirm('Remove this resource link?'))void act(async()=>api(`/api/resources/${r.id}`,user,{method:'DELETE'}));}}><X size={15}/></button></div>)}
                  {!selectedResources.length&&<EmptyState icon={<FileText size={23}/>} title="No linked resources" detail="Connect Goodnotes backup PDFs from Library, or add DTU Learn links."/>}
                  <button className="btn secondary full" onClick={()=>{setLinkCourse(courseId);setLinkWeek(weekNumber);setTab('library');}}><Cloud size={16}/> Browse Google Drive backups</button>
                </Card>
                <Card className="hint-card"><SectionTitle title="Stay in your existing workflow"/><p>Keep handwriting in Goodnotes. This library links to the backed-up PDF, which opens in Study Hub without copying the original into Firebase.</p></Card>
              </div></div>}
            </>}
          </>}

          {tab==='tasks'&&<>
            <div className="page-heading"><div><span className="eyebrow"><CheckCircle2 size={13}/> YOUR ACTION LIST</span><h1>Clear mind. Clear tasks.</h1><p>Everything on your plate, without the overwhelm.</p></div><button className="btn primary" onClick={()=>setTaskForm(!taskForm)}><Plus size={17}/> New task</button></div>
            {taskForm&&<Card className="form-card"><h3>New personal task</h3><form className="form-grid" onSubmit={newTask}><FormRow label="What do you need to do?"><input required value={taskDraft.title} onChange={e=>setTaskDraft(p=>({...p,title:e.target.value}))} placeholder="Buy groceries"/></FormRow><FormRow label="Priority"><select value={taskDraft.priority} onChange={e=>setTaskDraft(p=>({...p,priority:e.target.value}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></FormRow><FormRow label="Planned date"><input type="date" value={taskDraft.planned_date} onChange={e=>setTaskDraft(p=>({...p,planned_date:e.target.value}))}/></FormRow><FormRow label="Due date"><input type="date" value={taskDraft.due_date} onChange={e=>setTaskDraft(p=>({...p,due_date:e.target.value}))}/></FormRow><div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setTaskForm(false)}>Cancel</button><button className="btn primary" disabled={busy}>Create task</button></div></form></Card>}
            <Card><div className="filterbar"><div className="segmented">{(['today','upcoming','completed'] as const).map(k=><button key={k} className={taskFilter===k?'selected':''} onClick={()=>setTaskFilter(k)}>{k==='today'?'Today':k==='upcoming'?'Upcoming':'Completed'}</button>)}</div><span className="muted">{sortedTasks.length} tasks</span></div>
              {sortedTasks.length?sortedTasks.map(i=><div className="task-list-row" key={i.id}><input type="checkbox" checked={i.done} aria-label={`Complete ${i.title}`} onChange={()=>toggle(i)}/><div className="task-content"><strong className={i.done?'complete':''}>{i.title}</strong><div className="inline-meta"><Badge>{i.course_id?(data.courses.find(c=>c.id===i.course_id)?.code||'Study'):'Personal'}</Badge><Badge tone={i.priority==='high'?'warning':'muted'}>{i.priority} priority</Badge>{i.kind==='assignment'&&<Badge tone="good">Assignment</Badge>}</div><DayStatus i={i}/></div>{i.course_id&&<button className="icon-btn" title="Start focus" onClick={()=>startFrom(i)}><Timer size={17}/></button>}</div>):<EmptyState icon={<ListTodo size={24}/>} title="Nothing in this view" detail="New personal tasks appear here, along with scheduled revision and course assignments."/>}
            </Card>
            <div className="help-note">Planned date = when you intend to work. Due date = deadline. Editing one never changes the other.</div>
          </>}

          {tab==='focus'&&<>
            <div className="page-heading"><div><span className="eyebrow"><Target size={13}/> DEEP WORK</span><h1>Find your flow.</h1><p>Settle into a distraction-free session. Every minute counts.</p></div><Badge tone={active?active.status==='running'?'good':'warning':'muted'}>{active?active.status:'Ready'}</Badge></div>
            <div className="focus-layout"><Card className="focus-card">
              {!active&&<div className="focus-settings"><FormRow label="Course (optional)"><select value={focusCourse} onChange={e=>{setFocusCourse(e.target.value);setFocusItem('');}}><option value="">General study</option>{data.courses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></FormRow><FormRow label="Study task (optional)"><select value={focusItem} onChange={e=>setFocusItem(e.target.value)}><option value="">No linked task</option>{data.items.filter(i=>i.course_id===focusCourse).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></FormRow></div>}
              {active&&<div className="focus-context"><Badge tone="good">Active session</Badge><strong>{data.items.find(i=>i.id===active.item_id)?.title||data.courses.find(c=>c.id===active.course_id)?.title||'General focus'}</strong></div>}
              <div className="focus-modes">{(['25','50','90','free'] as const).map(m=><button key={m} disabled={!!active} className={focusMode===m?'current':''} onClick={()=>setFocusMode(m)}>{m==='free'?'Stopwatch':`${m} min`}</button>)}</div>
              <div className="timer-dial"><span className="dial-label">{active?active.status==='paused'?'PAUSED':'FOCUSING':focusMode==='free'?'STOPWATCH':'FOCUS TARGET'}</span><strong>{active?duration(elapsedFocus(active,now)):focusMode==='free'?'00:00:00':duration(Number(focusMode)*60)}</strong><span className="dial-sub">{active?.mode!=='free'&&active?`Target: ${active.mode} minutes`:active?'Count-up session':'Ready when you are'}</span></div>
              {active? <div className="focus-buttons"><button className="btn secondary" onClick={()=>sessionAction(active.status==='running'?'pause':'resume')} disabled={busy}>{active.status==='running'?<Pause size={17}/>:<Play size={17}/>} {active.status==='running'?'Pause':'Resume'}</button><button className="btn primary" onClick={reviewFinish}><Square size={15}/> Finish & review</button></div>:<button className="btn primary focus-start" disabled={busy} onClick={beginFocus}><Play size={18}/> Start focusing</button>}
              <p className="focus-tip">The session persists on the backend. If you close this tab, return here to review, resume or correct the elapsed time.</p>
            </Card><div className="stack"><Card><SectionTitle title="Your focus statistics"/><div className="focus-stat"><span>This week</span><strong>{(weekSeconds/3600).toFixed(1)} hours</strong></div><div className="focus-stat"><span>All time</span><strong>{(totalSeconds/3600).toFixed(1)} hours</strong></div><div className="focus-stat"><span>Completed sessions</span><strong>{data.sessions.filter(s=>s.status==='finished').length}</strong></div></Card><Card><SectionTitle title="Recent sessions"/>{data.sessions.filter(s=>s.status==='finished').sort((a,b)=>(b.ended_at||0)-(a.ended_at||0)).slice(0,5).map(s=><div className="session-row" key={s.id}><span><Check size={15}/></span><div><strong>{data.items.find(i=>i.id===s.item_id)?.title||'Focus session'}</strong><small>{new Date(s.started_at*1000).toLocaleDateString()} · {Math.round((s.focus_seconds||0)/60)} min</small></div></div>)}{!data.sessions.some(s=>s.status==='finished')&&<p className="muted">Your finished sessions will appear here.</p>}</Card></div></div>
            {finishReview&&active&&<div className="dialog-backdrop" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-label="Review focus session"><button className="dialog-close" onClick={()=>setFinishReview(false)} aria-label="Cancel"><X size={18}/></button><h2>Review session</h2><p>Confirm your actual focus time. If you left the browser open, reduce the time to exclude inactivity.</p><FormRow label={`Actual focus seconds (maximum ${elapsedFocus(active,now)})`}><input type="number" min={0} max={elapsedFocus(active,now)} value={finishSeconds} onChange={e=>setFinishSeconds(e.target.value)}/></FormRow><div className="dialog-actions"><button className="btn secondary" onClick={()=>setFinishReview(false)}>Keep running</button><button className="btn primary" disabled={busy||!Number.isFinite(Number(finishSeconds))||Number(finishSeconds)<0||Number(finishSeconds)>elapsedFocus(active,now)} onClick={finish}>Save session</button></div></div></div>}
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
            </div><div className="stack"><Card><SectionTitle title="Manual course & week linking"/><p className="muted compact">If Goodnotes filenames don't identify a week, choose the correct destination before clicking <strong>Link manually</strong>. You stay in control.</p><FormRow label="Course"><select value={linkCourse} onChange={e=>{setLinkCourse(e.target.value);setLinkWeek(1);}}><option value="">Select course</option>{data.courses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></FormRow><FormRow label="Week"><select value={linkWeek} onChange={e=>setLinkWeek(Number(e.target.value))}>{Array.from({length:data.courses.find(c=>c.id===linkCourse)?.week_count||13},(_,n)=><option key={n+1} value={n+1}>Week {n+1}</option>)}</select></FormRow><FormRow label="Material type"><select value={linkKind} onChange={e=>setLinkKind(e.target.value as Resource['kind'])}>{(['handwritten','annotated','slides','textbook','other'] as const).map(k=><option key={k} value={k}>{k==='handwritten'?'Handwritten notes':k==='annotated'?'Annotated slides':k==='slides'?'Original slides':k==='textbook'?'Textbook':'Other'}</option>)}</select></FormRow></Card>
              <Card className="hint-card"><h3>Keep using Goodnotes</h3><p>Continue handwriting there. After Goodnotes finishes backing up, press <strong>Scan for PDFs</strong> to update this library. Read linked PDF copies inside Study Hub. The original notes remain editable in Goodnotes.</p></Card>
            </div></div>
          </>}
        </>}
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{tabs.map(t=><button key={t.id} className={tab===t.id?'current':''} onClick={()=>setTab(t.id)}><t.icon size={19}/><span>{t.label}</span></button>)}</nav>
    {pdf&&<div className="pdf-overlay" role="dialog" aria-modal="true" aria-label={`PDF preview: ${pdf.title}`}><div className="pdf-topbar"><div><FileText size={18}/><strong>{pdf.title}</strong></div><div className="pdf-actions"><button className="btn secondary small" disabled={pdf.page<=1} onClick={()=>changePdfPage(pdf.page-1)}><ArrowLeft size={14}/></button><label>Page <input type="number" min={1} max={20000} value={pdfPageDraft} onChange={e=>setPdfPageDraft(e.target.value)} onBlur={()=>changePdfPage(Number(pdfPageDraft))} onKeyDown={e=>{if(e.key==='Enter')changePdfPage(Number(pdfPageDraft));}} aria-label="PDF page number"/></label><button className="btn secondary small" onClick={()=>changePdfPage(pdf.page+1)}><ArrowRight size={14}/></button><button className="btn secondary small" onClick={closePdf}><X size={16}/> Close</button></div></div><div className="pdf-guidance">Use the page control to jump between pages; for linked PDFs, the selected page is remembered. Scrolling inside the browser PDF viewer is not tracked automatically.</div><iframe key={`${pdf.url}-${pdf.page}`} title={pdf.title} src={`${pdf.url}#page=${pdf.page}`} className="pdf-frame"/></div>}
  </div>;
}
