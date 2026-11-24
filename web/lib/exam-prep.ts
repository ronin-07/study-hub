import type { Course, ExamAttempt, FocusSession, Item } from './types';

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
