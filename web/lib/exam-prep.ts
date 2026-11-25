import type { Course, ExamAttempt, FocusSession, Item, Resource } from './types';

export function examCountdown(date:string,today:string):string {
  const days=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
  return days===0?'Today':days<0?'Exam passed':`${days}d`;
}
export function upcomingExams(courses:Course[],today:string) {
  return courses.filter(c=>!c.archived&&c.exam_date&&c.exam_date>=today).sort((a,b)=>a.exam_date!.localeCompare(b.exam_date!)||(a.exam_time||'').localeCompare(b.exam_time||'')||a.code.localeCompare(b.code));
}
const words:Record<Item['kind'],RegExp>={lecture:/\blectures?\b/i,reading:/\breading\b/i,questions:/\bquestions?\b/i,revision:/\brevision\b/i,assignment:/\bassignments?\b/i,exercise:/\bexercises?\b/i,notes:/\bnotes?\b/i,personal:/\bpersonal\b/i};
export const categoryInTitle=(title:string,kind:Item['kind'])=>words[kind].test(title);
export function examFocusThisWeek(sessions:FocusSession[],items:Item[],courseId:string,now=new Date()):number {
  const monday=new Date(now);monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
  const start=monday.getTime()/1000;
  const ids=new Set(items.filter(i=>i.course_id===courseId&&i.week_number===null&&i.kind==='revision').map(i=>i.id));
  return sessions.filter(s=>s.course_id===courseId&&s.status==='finished'&&s.item_id&&ids.has(s.item_id)&&(s.ended_at??0)>=start&&(s.ended_at??0)<=now.getTime()/1000).reduce((total,s)=>total+Math.max(0,s.focus_seconds??0),0);
}
export function attemptSummary(attempts:ExamAttempt[]) {
  const scores=attempts.flatMap(a=>a.score===null?[]:[a.score]);
  return {count:attempts.length,best:scores.length?Math.max(...scores):null,minutes:attempts.reduce((total,a)=>total+a.minutes,0)};
}


export type ExamSort = 'year-desc' | 'year-asc' | 'name-asc' | 'name-desc';
export const examSortOptions: {value:ExamSort;label:string}[] = [{value:'year-desc',label:'Year: newest first'},{value:'year-asc',label:'Year: oldest first'},{value:'name-asc',label:'Name: A–Z'},{value:'name-desc',label:'Name: Z–A'}];
export function examFilenameDetails(title:string) {
  const match=/(fall|autumn|spring|summer|winter)[ _.-]*(19\d{2}|20\d{2}|2100)(?!\d)/i.exec(title) || /(19\d{2}|20\d{2}|2100)[ _.-]*(fall|autumn|spring|summer|winter)/i.exec(title);
  const year=match?Number(/^\d/.test(match[1])?match[1]:match[2]):null;
  const season=match?(/^\d/.test(match[1])?match[2]:match[1]).toLowerCase():null;
  const label=season==='fall'?'Autumn':season?season[0].toUpperCase()+season.slice(1):null;
  const fallback=title.replace(/\.pdf$/i,'');
  const years=[...new Set(fallback.match(/(?<!\d)(?:19\d{2}|20\d{2}|2100)(?!\d)/g)||[])];
  return {name:label&&year?`${label} ${year}`:fallback,year:year??(years.length===1?Number(years[0]):null),season:label};
}
export const examName=(paper:Resource)=>paper.exam_display_name||examFilenameDetails(paper.title).name;
export const examYear=(paper:Resource)=>paper.exam_display_name?paper.exam_year??null:paper.exam_year??examFilenameDetails(paper.title).year;
export function sortExamPapers(papers:Resource[],sort:ExamSort){
  const name=(a:Resource,b:Resource)=>examName(a).localeCompare(examName(b),undefined,{numeric:true,sensitivity:'base'});
  return [...papers].sort((a,b)=>{
    if(sort==='name-asc'||sort==='name-desc')return (sort==='name-asc'?1:-1)*name(a,b)||a.id.localeCompare(b.id);
    const x=examYear(a),y=examYear(b);
    if(x===null||y===null)return (x===null?1:0)-(y===null?1:0)||name(a,b)||a.id.localeCompare(b.id);
    return (sort==='year-asc'?x-y:y-x)||name(a,b)||a.id.localeCompare(b.id);
  });
}
export function suggestedSolutions(paper:Resource,solutions:Resource[]){
  const key=(title:string)=>title.toLowerCase().replace(/\.pdf$/,'').replace(/(?:corrected|solutions?|answers?|sol)(?=[\W_]|$)/g,'').replace(/[^a-z0-9]/g,'');
  return solutions.filter(s=>s.course_id===paper.course_id&&s.kind==='exam_solution'&&!s.exam_paper_id).map(resource=>({resource,match:key(resource.title)===key(paper.title)})).sort((a,b)=>Number(b.match)-Number(a.match)||a.resource.title.localeCompare(b.resource.title));
}
