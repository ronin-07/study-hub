import type {DriveEntry,DriveIndexed,Resource,Snapshot} from './types';
import {availableExamPapers,isExamResource} from './resource-links.ts';

export const bulkPdfLimit = 30;
type BulkFile = DriveEntry | DriveIndexed;

export function selectListedPdfs(selected: BulkFile[], listed: BulkFile[]): BulkFile[] {
  const byId = new Map(selected.map(file => [file.id, file]));
  for (const file of listed) {
    if (byId.size >= bulkPdfLimit) break;
    // The backup index only stores PDFs, and its records have no MIME field.
    if (('links' in file || file.mimeType === 'application/pdf') && !byId.has(file.id)) {
      byId.set(file.id, file);
    }
  }
  return byId.size === selected.length ? selected : [...byId.values()];
}

export type BulkDraft={id:string;file_id:string;title:string;course_id:string;kind:Resource['kind'];week_number:number|null;item_id:string;exam_paper_id:string;suggested:boolean;expectedActivity?:string};
function inferredKind(name:string):Resource['kind']{
  if(/(?:^|[\W_])(?:sol(?:ution)?s?|answer(?:s)?)(?:[\W_]|$)/i.test(name))return 'exam_solution';
  if(/(?:exam|\bpyq\b|ex[_-])/.test(name.toLowerCase())&&/20\d{2}/.test(name))return 'exam_paper';
  if(/(?:lecture|slides|week)[ _-]*\d+/i.test(name))return 'slides';
  return 'other';
}
function pairKey(name:string){return name.toLowerCase().replace(/\.pdf$/,'').replace(/(?:corrected|solutions?|answers?|sol)(?=[\W_]|$)/g,'').replace(/[^a-z0-9]/g,'');}
export function bulkPairCandidates(row:BulkDraft,rows:BulkDraft[],resources:Resource[]){
  const reserved = new Set(rows.filter(r => r.id !== row.id && r.kind === 'exam_solution').map(r => r.exam_paper_id));
  const existing = availableExamPapers(resources, row.course_id);
  const linkedFiles = new Set(resources.filter(r => r.course_id === row.course_id && r.source === 'drive').map(r => r.drive_file_id));
  const newPapers = rows.filter(r => r.kind === 'exam_paper' && r.course_id === row.course_id && !linkedFiles.has(r.file_id));
  return [...existing, ...newPapers].filter(paper => !reserved.has(paper.id)).map(({id,title}) => ({id,title}));
}
export function bulkDrafts(files:(DriveEntry|DriveIndexed)[],data:Snapshot,initialCourse:string,newId:()=>string):BulkDraft[]{
  const active=data.courses.filter(c=>!c.archived);
  const rows=[...new Map(files.map(f=>[f.id,f])).values()].slice(0,bulkPdfLimit).map(f=>{
    const suggestion='suggestion' in f?f.suggestion:null;
    const kindGuess=inferredKind(f.name);
    const kind=isExamResource(kindGuess)?kindGuess:suggestion?.kind||kindGuess;
    const course=active.find(c=>c.id===suggestion?.course_id)||active.find(c=>c.id===initialCourse);
    const match=/(?:lecture|week)[ _-]*(\d{1,2})(?!\d)/i.exec(f.name);
    const week=suggestion?.week_number??(match?Number(match[1]):1);
    return {id:newId(),file_id:f.id,title:f.name.slice(0,240),course_id:course?.id||'',kind,week_number:isExamResource(kind)||kind==='textbook'?null:week,item_id:'',exam_paper_id:'',suggested:Boolean(suggestion||match||isExamResource(kind))};
  });
  for(const r of rows){if(r.kind==='exam_solution'&&r.course_id){const matches=bulkPairCandidates(r,rows,data.resources).filter(p=>pairKey(p.title)===pairKey(r.title));if(matches.length===1)r.exam_paper_id=matches[0].id;}}
  return rows;
}
export function validBulkRow(row:BulkDraft,rows:BulkDraft[],data:Snapshot){
  const course=data.courses.find(c=>c.id===row.course_id&&!c.archived);if(!course)return false;
  if(!isExamResource(row.kind)&&row.week_number!=null&&(row.week_number<1||row.week_number>course.week_count))return false;
  if(row.item_id&&(isExamResource(row.kind)||row.week_number==null||!data.items.some(i=>i.id===row.item_id&&i.course_id===row.course_id&&i.week_number===row.week_number)))return false;
  if(row.exam_paper_id&&(row.kind!=='exam_solution'||!bulkPairCandidates(row,rows,data.resources).some(p=>p.id===row.exam_paper_id)))return false;
  return true;
}
