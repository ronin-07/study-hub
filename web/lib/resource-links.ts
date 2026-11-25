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
