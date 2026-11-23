import type { Item } from './types';
import { formatStudyReference, kindLabels } from './types';

/** Shared, presentation-only activity labels. Stored question/chapter text is untouched. */
export function activityReference(item: Pick<Item, 'kind' | 'chapter'>): string | null {
  if (!item.chapter?.trim()) return null;
  const label = item.kind === 'questions' ? 'Questions' : item.kind === 'reading' ? 'Chapters' : 'Section';
  return `${label} ${formatStudyReference(item.chapter)}`;
}

export function activityKindFallback(item: Pick<Item, 'kind' | 'chapter'>): string | null {
  return activityReference(item) ? null : item.kind === 'personal' ? null : kindLabels[item.kind];
}

/** Localized date-only formatting; no time-zone conversion of Firestore YYYY-MM-DD dates. */
export function shortStudyDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(year, month - 1, day, 12))}`;
}

/** A missed plan is not a missed deadline. Shared only by presentation layers. */
export function activityStatus(item: Pick<Item, 'done' | 'planned_date' | 'due_date'>, today: string): 'completed' | 'overdue' | 'past-plan' | 'today' | 'none' {
  if (item.done) return 'completed';
  if (item.due_date && item.due_date < today) return 'overdue';
  if (item.planned_date && item.planned_date < today) return 'past-plan';
  if (item.due_date === today || item.planned_date === today) return 'today';
  return 'none';
}

export function activityStatusLabel(status: ReturnType<typeof activityStatus>): string {
  return { completed: 'Completed', overdue: 'Overdue', 'past-plan': 'Plan missed', today: 'Today', none: '' }[status];
}
