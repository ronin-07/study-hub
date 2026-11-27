import type { Course, DriveEntry, DriveIndexed, DriveSuggestion, Snapshot } from './types';

// Only whole tokens: IDLCV_L05, Lecture_5, Week-5, W05, etc.
const weekPattern = /(?:^|[^a-z0-9])(?:lecture|week|lec|wk|l|w)[\s._-]*(\d{1,2})(?=$|[^a-z0-9])/gi;
const ignoredWords = new Set(['a','an','the','of','to','in','on','for','and','with','at','by','from']);

export function filenameWeek(context:string):number|null {
  const hits = [...new Set([...context.matchAll(weekPattern)].map(m=>Number(m[1])))];
  return hits.length===1 && hits[0]>0 ? hits[0] : null;
}

export function courseAcronym(title:string):string {
  return (title.toLowerCase().match(/[a-z0-9]+/g)||[]).filter(w=>!ignoredWords.has(w)).map(w=>w[0]).join('');
}

export function filenameCourse(context:string,courses:Course[]):Course|undefined {
  const active = courses.filter(c=>!c.archived);
  const codes = active.filter(c=>c.code && new RegExp(`(?<!\\d)${c.code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?!\\d)`,'i').test(context));
  if(codes.length) return codes.length===1 ? codes[0] : undefined;
  const tokens = new Set(context.toLowerCase().match(/[a-z0-9]+/g)||[]);
  const aliases = active.filter(c=>{const acronym=courseAcronym(c.title||'');return acronym.length>=3&&tokens.has(acronym);});
  return aliases.length===1 ? aliases[0] : undefined;
}

export function filenameMaterial(name:string):DriveSuggestion['kind'] {
  if(/annotat|highlight|marked|goodnotes.*slide/i.test(name))return 'annotated';
  if(/handwrit|my[\s_-]*notes|notebook|notes/i.test(name))return 'handwritten';
  if(/textbook|chapter|\bch[\s._-]*\d|reading|book/i.test(name))return 'textbook';
  if(/slide|lecture/i.test(name)||filenameWeek(name)!==null)return 'slides';
  return 'other';
}

export function fileContext(file:DriveEntry|DriveIndexed):string {
  return 'path' in file ? `${file.path}/${file.name}` : file.name;
}

// A server suggestion uses folder evidence too. For regular Drive files, require
// both an unambiguous course and an in-range week before prefilling single links.
export function fileSuggestion(file:DriveEntry|DriveIndexed,data:Snapshot):DriveSuggestion|null {
  if('suggestion' in file && file.suggestion && data.courses.some(c=>c.id===file.suggestion?.course_id&&!c.archived))return file.suggestion;
  const context=fileContext(file);
  const course=filenameCourse(context,data.courses);
  const week=filenameWeek(context);
  if(!course||week===null||week>course.week_count)return null;
  return {course_id:course.id,course_code:course.code,week_number:week,week_title:data.weeks.find(w=>w.course_id===course.id&&w.number===week)?.title||null,kind:filenameMaterial(file.name),confidence:'low',reason:'Filename course and week suggestion; review before linking'};
}
