/** Progress counts are about learning scope, not whether a task is visible in Tasks. */
import type { Item } from './types';

/** Course learning completion: only records attached to a teaching week. */
export function courseLearningItems(items: Item[], courseId: string): Item[] {
  return items.filter(item => item.course_id===courseId && typeof item.week_number==='number');
}

/** Course-wide exam preparation stays separate from teaching-week completion. */
export function examPreparationItems(items: Item[], courseId: string): Item[] {
  return items.filter(item => item.course_id===courseId && item.week_number===null && item.kind==='revision');
}
