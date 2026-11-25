import type { Item, Resource } from './types';

/** Both historical reference directions are supported. Each record appears once. */
export function activityResources(item: Item, resources: Resource[]): Resource[] {
  return resources.filter(r => r.course_id === item.course_id && (r.week_number == null || r.week_number === item.week_number)
    && (r.id === item.resource_id || r.item_id === item.id));
}
export function isExamResource(kind: Resource['kind']): boolean { return kind === 'exam_paper' || kind === 'exam_solution'; }
export function pairedSolutions(paper: Resource, resources: Resource[]): Resource[] {
  return resources.filter(r=>r.kind==='exam_solution' && r.course_id===paper.course_id && r.exam_paper_id===paper.id);
}

/** Reader shortcuts are drawn from the open document's study context. */
export function readerMaterials(current: Resource | undefined, week: number | undefined, items: Item[], resources: Resource[]): Resource[] {
  if (!current) return [];
  const candidates = resources.filter(resource => resource.id !== current.id && resource.course_id === current.course_id
    && ((resource.source === 'drive' && resource.drive_file_id) || resource.url));
  if (current.kind === 'exam_paper') return pairedSolutions(current, candidates);
  if (current.kind === 'exam_solution') {
    return candidates.filter(resource => resource.kind === 'exam_paper' && resource.id === current.exam_paper_id);
  }
  if (week == null) return [];

  const studyFiles = candidates.filter(resource => !isExamResource(resource.kind));
  const linked = new Set(items.filter(item => item.course_id === current.course_id && item.week_number === week)
    .flatMap(item => activityResources(item, studyFiles).map(resource => resource.id)));
  return studyFiles.filter(resource => resource.week_number === week || linked.has(resource.id))
    .sort((a,b) => Number(linked.has(b.id)) - Number(linked.has(a.id)) || a.title.localeCompare(b.title, undefined, {numeric:true}) || a.id.localeCompare(b.id));
}

export function availableExamPapers(resources: Resource[], courseId: string, currentPaperId?: string | null): Resource[] {
  const occupied = new Set(resources.map(resource => resource.exam_paper_id).filter(Boolean));
  return resources.filter(paper => paper.kind === 'exam_paper' && paper.course_id === courseId
    && (paper.id === currentPaperId || !occupied.has(paper.id)));
}
