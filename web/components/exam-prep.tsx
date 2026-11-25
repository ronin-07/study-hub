'use client';

import {useEffect,useId,useRef,useState,type CSSProperties,type FormEvent} from 'react';
import type {User} from 'firebase/auth';
import {ChevronLeft,ChevronRight,Cloud,FileText,History,ListFilter,LoaderCircle,Pencil,Plus,Timer,Trash2,Unlink,X} from 'lucide-react';
import {Card,FormRow,SectionTitle} from '@/components/common';
import {ProgressTrack,ProgressValue} from '@/components/progress-motion';
import {WorkspaceActionsMenu} from '@/components/task-actions-menu';
import {api} from '@/lib/api';
import type {FeedbackMessage} from '@/components/feedback-toasts';
import type {MutationHint} from '@/lib/snapshot-cache';
import {type Course,type Resource,type ExamAttempt,type FocusMode,formatDate,localToday} from '@/lib/types';
import {checklistPercent} from '@/lib/progress-presentation';
import {
  attemptSummary,examCountdown,examName,examPaperPage,examPageSizes,examYear,examSortOptions,filterExamPapers,formatExamDuration,
  practiceFocusMode,sortExamPapers,suggestedSolutions,type ExamSort,type ExamAttemptFilter,type ExamPageSize,
} from '@/lib/exam-prep';
import {pairedSolutions} from '@/lib/resource-links';

const timeLabel=(minutes:number)=>`${Math.floor(minutes/60)}h ${minutes%60}m`;

export function ExamHero({course,courseDone,courseTotal,revisionDone,revisionTotal,focusSeconds,onEdit}:{
  course:Course;courseDone:number;courseTotal:number;revisionDone:number;revisionTotal:number;focusSeconds:number;onEdit?:()=>void;
}) {
  const countdown=course.exam_date?examCountdown(course.exam_date,localToday()):null;
  const headline=countdown===null?'Exam date not set':countdown==='Today'?'Exam today':countdown==='Exam passed'?'Exam date passed':`${countdown.slice(0,-1)} ${countdown==='1d'?'day':'days'} to go`;
  const progress=[
    {scope:'coursework',label:'Coursework',done:courseDone,total:courseTotal,empty:'No coursework activities yet',complete:'Coursework complete'},
    {scope:'revision',label:'Exam revision',done:revisionDone,total:revisionTotal,empty:'No revision tasks yet',complete:'Revision checklist complete'},
  ];
  return <div className="planner-hero planner-study-hero planner-exam-hero">
    <div>
      <span>EXAM PREPARATION</span><h3>{headline}</h3>
      <p>{course.exam_date?formatDate(course.exam_date):'Add the date in course settings'}{course.exam_date&&course.exam_time?` · ${course.exam_time.slice(0,5)}`:''}</p>
      {course.exam_date&&<p>{[course.exam_format,formatExamDuration(course.exam_duration_minutes),course.exam_location].filter(Boolean).join(' · ')}</p>}
      {onEdit&&<button className="exam-hero-edit" onClick={onEdit}><Pencil size={14} aria-hidden="true"/> {course.exam_date?'Edit exam details':'Set exam date'}</button>}
    </div>
    <div className="exam-hero-progresses">{progress.map(p=>{
      const percent=checklistPercent(p.done,p.total);
      return <div className={`exam-progress-panel exam-progress-${p.scope}`} key={p.scope}>
        <span>{p.label}</span>
        <strong>{p.total?<ProgressValue key={course.id} value={percent}/>: '—'}</strong>
        <ProgressTrack identity={`${course.id}-${p.scope}`} label={`${p.label} completion`} value={percent} completionMessage={p.complete}/>
        <small>{p.total?`${p.done} of ${p.total} completed`:p.empty}</small>
      </div>;
    })}
      <div className="exam-progress-panel exam-focus-panel">
        <span>Exam Focus</span>
        <strong>{timeLabel(Math.floor(focusSeconds/60))}</strong>
        <small>This week</small>
      </div>
    </div>
    {course.exam_aids?.trim()&&<details className="exam-hero-aids">
      <summary>Exam aids</summary>
      <p>{course.exam_aids}</p>
    </details>}
  </div>;
}

type Props={
  papers:Resource[];solutions:Resource[];editResource:(r:Resource)=>void;removeResource:(r:Resource)=>void;
  addSolution:(paper:Resource)=>void;user:User|null;busy:boolean;readOnly:boolean;
  run:(op:()=>Promise<unknown>,hint?:MutationHint,feedback?:FeedbackMessage)=>Promise<boolean>;
  openResource:(r:Resource)=>void;browseDrive:()=>void;practice:(r:Resource,mode:FocusMode)=>Promise<boolean>;
  examDuration?:number|null;activeFocus:boolean;focusBusy:boolean;openFocus:()=>void;
};
type DialogMode='attempts'|'rename'|'pair'|'practice';
const blank=()=>({id:'',date:localToday(),minutes:'',score:'',notes:''});

export function ExamPapers({papers,solutions,editResource,removeResource,addSolution,user,busy,readOnly,run,
  openResource,browseDrive,practice,examDuration,activeFocus,focusBusy,openFocus}:Props) {
  const [paperId,setPaperId]=useState('');
  const [entry,setEntry]=useState(false);
  const [sort,setSort]=useState<ExamSort>('year-desc');
  const [query,setQuery]=useState('');
  const [attemptFilter,setAttemptFilter]=useState<ExamAttemptFilter>('all');
  const [missingSolution,setMissingSolution]=useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [pageSize,setPageSize]=useState<ExamPageSize>('6');
  const [requestedPage,setRequestedPage]=useState(1);
  const [mode,setMode]=useState<DialogMode>('attempts');
  const [name,setName]=useState('');
  const [year,setYear]=useState('');
  const [solutionId,setSolutionId]=useState('');
  const [timer,setTimer]=useState<'countdown'|'stopwatch'>('countdown');
  const [minutes,setMinutes]=useState('');
  const [issue,setIssue]=useState('');
  const [draft,setDraft]=useState(blank);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const filterButton=useRef<HTMLButtonElement>(null);
  const resultsStatus=useRef<HTMLParagraphElement>(null);
  const filtersId=useId();
  const resultsId=useId();
  const paper=papers.find(p=>p.id===paperId);
  const linked=paper?pairedSolutions(paper,solutions):[];
  const pairedIds=new Set(solutions.flatMap(s=>s.exam_paper_id?[s.exam_paper_id]:[]));
  const candidates=paper&&mode==='pair'&&!linked.length?suggestedSolutions(paper,solutions):[];
  const timerMode=practiceFocusMode(timer,minutes);

  useEffect(()=>{
    try {
      const saved=localStorage.getItem('studyhub.exam-sort');
      const option=examSortOptions.find(o=>o.value===saved);
      if(option)setSort(option.value);
      const savedSize=examPageSizes.find(size=>size===localStorage.getItem('studyhub.exam-page-size'));
      if(savedSize)setPageSize(savedSize);
    } catch {}
  },[]);
  useEffect(()=>{
    const node=dialogRef.current;
    if(paper&&node&&!node.open)node.showModal();
    else if(!paper&&node?.open)node.close();
  },[paper]);

  const changeSort=(value:ExamSort)=>{
    setSort(value);
    setRequestedPage(1);
    try {localStorage.setItem('studyhub.exam-sort',value);} catch {}
  };
  const changePageSize=(value:ExamPageSize)=>{
    setPageSize(value);
    setRequestedPage(1);
    try {localStorage.setItem('studyhub.exam-page-size',value);} catch {}
  };
  const close=()=>{dialogRef.current?.close();setPaperId('');setEntry(false);setIssue('');};
  const open=(r:Resource,next:DialogMode='attempts')=>{
    setMode(next);setPaperId(r.id);setEntry(false);setIssue('');
    if(next==='rename'){setName(examName(r));setYear(String(examYear(r)??''));}
    if(next==='pair'){
      const matches=suggestedSolutions(r,solutions).filter(s=>s.match);
      setSolutionId(matches.length===1?matches[0].resource.id:'');
    }
    if(next==='practice'){setTimer('countdown');setMinutes(String(examDuration??''));}
  };
  const saveDetails=async(e:FormEvent)=>{
    e.preventDefault();
    if(!paper||busy||readOnly||!name.trim())return;
    const ok=await run(()=>api<Resource>(`/api/resources/${paper.id}/exam-details`,user,{
      method:'PATCH',body:{display_name:name.trim(),year:year===''?null:Number(year)},
    }),{collection:'resources'},{title:'Exam details saved'});
    if(ok)close();else setIssue('Could not save exam details. Try again.');
  };
  const pairExisting=async(e:FormEvent)=>{
    e.preventDefault();
    if(!paper||busy||readOnly||!candidates.some(c=>c.resource.id===solutionId))return;
    const ok=await run(()=>api<Resource>(`/api/resources/${paper.id}/pair-existing-solution`,user,{
      method:'POST',body:{solution_id:solutionId},
    }),{collection:'resources'},{title:'Solution paired'});
    if(ok)close();else setIssue('Could not pair this solution. Refresh and review the available papers.');
  };
  const unpair=(p:Resource,solution:Resource)=>void run(
    ()=>api<Resource>(`/api/resources/${p.id}/paired-solutions/${solution.id}`,user,{method:'DELETE'}),
    {collection:'resources'},{title:'Solution unpaired',detail:solution.title},
  );
  const preparePractice=async(e:FormEvent)=>{
    e.preventDefault();
    if(!paper||readOnly||busy||focusBusy||activeFocus||!timerMode)return;
    if(!await practice(paper,timerMode))setIssue('Could not prepare practice. Check Focus or try again.');
  };
  const begin=()=>{setDraft({...blank(),id:crypto.randomUUID()});setIssue('');setEntry(true);};
  const save=async(e:FormEvent)=>{
    e.preventDefault();
    if(!paper||busy||readOnly)return;
    const body:ExamAttempt={id:draft.id,date:draft.date,minutes:Number(draft.minutes),score:draft.score===''?null:Number(draft.score),notes:draft.notes.trim()};
    const ok=await run(()=>api<Resource>(`/api/resources/${paper.id}/exam-attempts`,user,{method:'POST',body}),
      {collection:'resources'},{title:'Practice attempt recorded',detail:paper.title});
    if(ok){setEntry(false);setIssue('');}
    else setIssue('Could not confirm the save. Retry without changing the attempt, or refresh to verify.');
  };
  const remove=async(a:ExamAttempt)=>{
    if(!paper||!confirm('Delete this recorded attempt?'))return;
    const ok=await run(()=>api<Resource>(`/api/resources/${paper.id}/exam-attempts/${a.id}`,user,{method:'DELETE'}),
      {collection:'resources'},{title:'Attempt deleted'});
    setIssue(ok?'':'Could not confirm deletion. Retry or refresh.');
  };

  const summary=attemptSummary(paper?.exam_attempts||[]);
  const unpaired=solutions.filter(s=>!papers.some(p=>p.id===s.exam_paper_id));
  const visible=sortExamPapers(filterExamPapers(papers,query,attemptFilter,missingSolution,pairedIds),sort);
  const page=examPaperPage(visible,requestedPage,pageSize);
  useEffect(()=>{
    setRequestedPage(current=>Math.min(current,page.pageCount));
  },[page.pageCount]);
  const changePage=(next:number)=>{
    if(next<1||next>page.pageCount)return;
    setRequestedPage(next);
    const status=resultsStatus.current;
    if(status&&status.getBoundingClientRect().top<0){
      status.focus({preventScroll:true});
      status.scrollIntoView({block:'center'});
    }
  };
  const activeFilters=Number(attemptFilter!=='all')+Number(missingSolution);
  // Reserve the unfiltered page, with a six-paper floor for the unbounded All view.
  const reservedCards=Math.min(papers.length,Number(pageSize==='all'?'6':pageSize));
  const resultsStyle={
    '--exam-rows-one':reservedCards,
    '--exam-rows-two':Math.ceil(reservedCards/2),
    '--exam-rows-three':Math.ceil(reservedCards/3),
  } as CSSProperties;
  const showNavigation=pageSize!=='all'&&papers.length>Number(pageSize);
  const resultRange=page.first===page.last ? String(page.first) : `${page.first}–${page.last}`;
  const openDocument=(r:Resource,label:string,fromDialog=false)=>(
    <button key={r.id} className="btn secondary small exam-document-open" title={r.title}
      aria-label={label===r.title?r.title:`${label}: ${r.title}`} onClick={()=>{if(fromDialog)close();openResource(r);}}>
      <FileText size={15} aria-hidden="true"/><span>{label}</span>
    </button>
  );
  const editDocument=(r:Resource,label:string)=>({label:`Edit ${label}`,title:r.title,icon:Pencil,run:()=>editResource(r)});
  const removeDocument=(r:Resource,label:string)=>({label:`Remove ${label}`,title:r.title,icon:Trash2,run:()=>removeResource(r),danger:true});
  const heading=paper?{rename:'Edit exam details',pair:'Link exam solution',practice:'Start exam practice',attempts:examName(paper)}[mode]:'';

  return <div className="planner-exam-collection">
    <Card className="planner-exam-papers">
      <SectionTitle title="Past exam papers" aside={!readOnly&&<button className="btn primary small" disabled={busy} onClick={browseDrive}><Cloud size={15} aria-hidden="true"/> Link through Drive</button>}/>
      <p className="planner-study-hint">{papers.length} {papers.length===1?'paper':'papers'} · {solutions.length-unpaired.length} paired {solutions.length-unpaired.length===1?'solution':'solutions'}</p>
      {papers.length>0&&<>
        <div className="exam-papers-toolbar">
          <FormRow label="Search exams"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);setRequestedPage(1);}} placeholder="Name, year or filename"/></FormRow>
          <FormRow label="Sort papers"><select value={sort} onChange={e=>changeSort(e.target.value as ExamSort)}>{examSortOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></FormRow>
          <div className="exam-filter-control"
            onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFiltersOpen(false);}}
            onKeyDown={e=>{
              if(e.key==='Escape'&&filtersOpen){e.preventDefault();setFiltersOpen(false);filterButton.current?.focus();}
            }}>
            <button type="button" className="btn secondary small exam-filters-button" ref={filterButton}
              aria-expanded={filtersOpen} aria-controls={filtersId}
              onClick={e=>{e.currentTarget.focus();setFiltersOpen(open=>!open);}}>
              <ListFilter size={16} aria-hidden="true"/> Filters{activeFilters>0&&` (${activeFilters})`}
            </button>
            <div className="exam-filter-panel" id={filtersId} hidden={!filtersOpen}>
              <FormRow label="Attempts"><select value={attemptFilter} onChange={e=>{setAttemptFilter(e.target.value as ExamAttemptFilter);setRequestedPage(1);}}>
                <option value="all">All papers</option><option value="unattempted">Not attempted</option><option value="attempted">Attempted</option>
              </select></FormRow>
              <label className="inline-check exam-missing-filter"><input type="checkbox" className="task-completion-check" checked={missingSolution}
                onChange={e=>{setMissingSolution(e.target.checked);setRequestedPage(1);}}/> Missing solution only</label>
            </div>
          </div>
        </div>
        <p className="planner-study-hint exam-results" role="status" ref={resultsStatus} tabIndex={-1}>
          {visible.length>0
            ? `Showing ${resultRange} of ${visible.length} ${visible.length===1?'paper':'papers'}`
            : 'No papers match your search and filters.'}
        </p>
        <div className="exam-papers-grid" id={resultsId} style={resultsStyle}>{page.papers.map(p=>{
          const stats=attemptSummary(p.exam_attempts||[]);
          const paired=pairedSolutions(p,solutions);
          const solutionLabel=(index:number)=>paired.length>1?`solution ${index+1}`:'solution';
          return <article className="exam-paper-group" key={p.id}>
            <div className="exam-pair-heading">
              <div><h4 title={examName(p)}>{examName(p)}</h4><small>{stats.count?`${stats.count} ${stats.count===1?'attempt':'attempts'}`:'Not attempted'}{stats.best===null?'':` · Best ${stats.best}%`}</small></div>
              {!readOnly&&<WorkspaceActionsMenu className="exam-action-menu" title={examName(p)} busy={busy} actions={[
                {label:'Rename exam',icon:Pencil,run:()=>open(p,'rename')},
                editDocument(p,'question paper'),
                ...paired.map((r,i)=>editDocument(r,solutionLabel(i))),
                ...paired.map((r,i)=>({label:`Unpair ${solutionLabel(i)}`,title:r.title,icon:Unlink,run:()=>unpair(p,r)})),
                ...paired.map((r,i)=>removeDocument(r,solutionLabel(i))),
                removeDocument(p,'question paper'),
              ]}/>}
            </div>
            <div className="exam-pair-documents" aria-label={`Documents for ${examName(p)}`} role="group">
              {openDocument(p,'Question paper')}
              {paired.map((r,i)=>openDocument(r,paired.length>1?`Solution ${i+1}`:'Solution'))}
              {paired.length===0&&(readOnly?<span className="planner-study-hint">No solution paired</span>:
                <button className="btn secondary small exam-link-solution" disabled={busy} onClick={()=>open(p,'pair')}><Plus size={15} aria-hidden="true"/> Link solution</button>)}
            </div>
            <div className="exam-pair-actions">
              <button className="btn secondary small" aria-label={`Attempts for ${examName(p)}`} onClick={()=>open(p)}><History size={15} aria-hidden="true"/> Attempts</button>
              {!readOnly&&p.week_number==null&&<button className="btn primary small" aria-label={`Practise ${examName(p)}`} disabled={busy} onClick={()=>open(p,'practice')}><Timer size={15} aria-hidden="true"/> Practice</button>}
            </div>
          </article>;
        })}</div>
        <div className="exam-pagination">
          {showNavigation&&<nav aria-label="Exam paper pages">
            <button type="button" className="btn secondary small" aria-label="Previous page" aria-controls={resultsId}
              aria-disabled={page.page===1} onClick={()=>changePage(page.page-1)}><ChevronLeft size={18} aria-hidden="true"/></button>
            <span>Page {page.page} of {page.pageCount}</span>
            <button type="button" className="btn secondary small" aria-label="Next page" aria-controls={resultsId}
              aria-disabled={page.page===page.pageCount} onClick={()=>changePage(page.page+1)}><ChevronRight size={18} aria-hidden="true"/></button>
          </nav>}
          <FormRow label="Papers per page">
            <select value={pageSize} onChange={e=>changePageSize(e.target.value as ExamPageSize)}>
              {examPageSizes.map(size=><option key={size} value={size}>{size==='all'?'All':size}</option>)}
            </select>
          </FormRow>
        </div>
      </>}
      {!papers.length&&<p className="planner-study-hint">Link past papers and solutions through Drive to start practising.</p>}
    </Card>

    {unpaired.length>0&&<Card className="planner-exam-unpaired">
      <SectionTitle title="Unpaired solutions"/>
      {unpaired.map(r=><div className="exam-document-line" key={r.id}>
        {openDocument(r,r.title)}
        {!readOnly&&<WorkspaceActionsMenu className="exam-action-menu" title={r.title} busy={busy} actions={[editDocument(r,'solution'),removeDocument(r,'solution')]}/>}
      </div>)}
    </Card>}

    <dialog ref={dialogRef} className="dialog planner-dialog exam-paper-dialog"
      onCancel={e=>{e.preventDefault();if(!busy)close();}} onClose={()=>{setPaperId('');setEntry(false);}} aria-labelledby="exam-paper-title">
      {paper&&<>
        <button className="dialog-close" aria-label="Close paper details" disabled={busy} onClick={close}><X size={18} aria-hidden="true"/></button>
        <h2 id="exam-paper-title">{heading}</h2>
        {mode!=='attempts'&&<p className="planner-study-hint">{mode==='rename'?paper.title:examName(paper)}</p>}
        {issue&&<p role="alert" className="exam-attempt-error">{issue}</p>}
        {mode==='rename'&&<form onSubmit={e=>void saveDetails(e)}>
          <fieldset className="exam-attempt-fields" disabled={busy||readOnly}>
            <FormRow label="Exam display name"><input required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></FormRow>
            <FormRow label="Exam year (optional)"><input type="number" min={1900} max={2100} step={1} value={year} onChange={e=>setYear(e.target.value)}/></FormRow>
            <div className="form-actions"><button type="button" className="btn secondary" onClick={close}>Cancel</button><button className="btn primary" disabled={!name.trim()}>{busy?'Saving…':'Save changes'}</button></div>
          </fieldset>
        </form>}
        {mode==='pair'&&(linked.length?<p role="status">This paper already has a solution.</p>:<>
          <form onSubmit={e=>void pairExisting(e)}>
            <fieldset className="exam-attempt-fields" disabled={busy||readOnly}>
              <legend>Available unpaired solutions</legend>
              {candidates.length?candidates.map(({resource:r,match})=><label className="exam-solution-choice" key={r.id}>
                <input type="radio" name="exam-solution" value={r.id} checked={solutionId===r.id} onChange={()=>setSolutionId(r.id)}/>
                <span><strong>{r.title}</strong>{match&&<small>Suggested filename match</small>}</span>
              </label>):<p className="planner-study-hint">No unpaired solutions in this course.</p>}
              {candidates.length>0&&<button className="btn primary full" disabled={!candidates.some(c=>c.resource.id===solutionId)}>{busy?'Pairing…':'Pair selected solution'}</button>}
            </fieldset>
          </form>
          <button className="btn secondary full" disabled={busy||readOnly} onClick={()=>{close();addSolution(paper);}}><Cloud size={15} aria-hidden="true"/> Link a new solution through Drive</button>
        </>)}
        {mode==='practice'&&(activeFocus?<>
          <p role="status">A Focus session is already running or paused. Finish or discard it before starting a practice timer.</p>
          <button className="btn primary full" onClick={()=>{close();openFocus();}}>Open current Focus session</button>
        </>:<form onSubmit={e=>void preparePractice(e)}>
          <fieldset className="exam-attempt-fields" disabled={busy||readOnly||focusBusy}>
            <FormRow label="Timer"><select value={timer} onChange={e=>setTimer(e.target.value==='stopwatch'?'stopwatch':'countdown')}>
              <option value="countdown">Countdown</option><option value="stopwatch">Stopwatch</option>
            </select></FormRow>
            {timer==='countdown'&&<FormRow label="Duration (1–720 minutes)"><input type="number" min={1} max={720} step={1} required value={minutes} onChange={e=>setMinutes(e.target.value)}/></FormRow>}
            <div className="form-actions"><button type="button" className="btn secondary" onClick={close}>Cancel</button><button className="btn primary" disabled={!timerMode} aria-busy={busy}>{busy?'Preparing…':'Continue to Focus'}</button></div>
          </fieldset>
        </form>)}
        {mode==='attempts'&&<>
          <div className="exam-pair-documents">
            {openDocument(paper,'Question paper',true)}
            {linked.map((r,i)=>openDocument(r,linked.length>1?`Solution ${i+1}`:'Solution',true))}
          </div>
          <div className="exam-attempt-stats">{[['Best score',summary.best===null?'—':`${summary.best}%`],['Attempts',String(summary.count)],['Time spent',timeLabel(summary.minutes)]].map(([label,value])=><div key={label}><strong>{value}</strong><small>{label}</small></div>)}</div>
          <SectionTitle title="Attempt history" aside={!readOnly&&!entry&&<button className="btn secondary small" disabled={busy} onClick={begin}><Plus size={14} aria-hidden="true"/> Record attempt</button>}/>
          {[...(paper.exam_attempts||[])].reverse().sort((a,b)=>b.date.localeCompare(a.date)).map(a=><div className="exam-attempt-row" key={a.id}>
            <div><strong>{formatDate(a.date)} · {timeLabel(a.minutes)}</strong>{a.notes&&<p>{a.notes}</p>}</div>
            <b>{a.score===null?'—':`${a.score}%`}</b>
            {!readOnly&&<button className="icon-btn danger-hover" aria-label={`Delete attempt from ${formatDate(a.date)}`} disabled={busy} onClick={()=>void remove(a)}><Trash2 size={15} aria-hidden="true"/></button>}
          </div>)}
          {!summary.count&&!entry&&<p className="planner-study-hint">No attempts recorded yet.</p>}
          {entry&&<form onSubmit={e=>void save(e)}>
            <fieldset disabled={busy||readOnly} className="exam-attempt-fields">
              <div className="form-grid">
                <FormRow label="Attempt date"><input type="date" required max={localToday()} value={draft.date} onChange={e=>setDraft(p=>({...p,date:e.target.value}))}/></FormRow>
                <FormRow label="Time spent (minutes)"><input type="number" min={1} max={1440} required value={draft.minutes} onChange={e=>setDraft(p=>({...p,minutes:e.target.value}))}/></FormRow>
                <FormRow label="Score % (optional)"><input type="number" min={0} max={100} step="any" value={draft.score} onChange={e=>setDraft(p=>({...p,score:e.target.value}))}/></FormRow>
              </div>
              <FormRow label="Mistakes and notes (optional)"><textarea rows={3} maxLength={1000} value={draft.notes} onChange={e=>setDraft(p=>({...p,notes:e.target.value}))}/></FormRow>
              <div className="form-actions">
                <button type="button" className="btn secondary" onClick={()=>setEntry(false)}>Cancel</button>
                <button className="btn primary" type="submit" aria-busy={busy}>{busy?<><LoaderCircle size={15} className="spin" aria-hidden="true"/> Saving…</>:'Save attempt'}</button>
              </div>
            </fieldset>
          </form>}
          {!readOnly&&!entry&&paper.week_number==null&&<button className="btn primary full" disabled={busy} onClick={()=>open(paper,'practice')}><Timer size={16} aria-hidden="true"/> Configure practice timer</button>}
        </>}
      </>}
    </dialog>
  </div>;
}
