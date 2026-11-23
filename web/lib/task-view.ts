/** Date-only task projections shared by Home and Tasks. Never mutate the snapshot. */
import type { Item } from './types';

/** A deadline is the last day work may be planned; an undated deadline is unrestricted. */
export function canPlanOnDate(item: Pick<Item, 'due_date'>, day: string): boolean {
  return !item.due_date || day <= item.due_date;
}

export function isActionable(item: Item): boolean {
  // Includes pre-fix documents whose planned/due date was saved without is_task.
  return !item.hidden_from_tasks && (item.is_task || item.kind === 'assignment' || !!item.planned_date || !!item.due_date);
}

export function isOverdue(item: Item, today: string): boolean {
  return !item.done && Boolean(
    (item.planned_date && item.planned_date < today) ||
    (item.due_date && item.due_date < today)
  );
}

export function belongsToToday(item: Item, today: string): boolean {
  return !item.done && Boolean(
    (item.planned_date && item.planned_date <= today) ||
    (item.due_date && item.due_date <= today)
  );
}

const priorityOrder = {high: 0, medium: 1, low: 2} as const;
export function todayPriorities(items: Item[], today: string): Item[] {
  return items.filter(i => belongsToToday(i, today)).sort((a,b) =>
    Number(isOverdue(b,today)) - Number(isOverdue(a,today)) ||
    priorityOrder[a.priority] - priorityOrder[b.priority] ||
    (a.planned_date || a.due_date || today).localeCompare(b.planned_date || b.due_date || today) ||
    a.title.localeCompare(b.title)
  );
}

export function upcomingWork(items: Item[], today: string): Item[] {
  return items.filter(i => !i.done && !belongsToToday(i, today));
}

/** Does not include overdue deadlines; those appear in Today's priorities. */
export function upcomingDeadlines(items: Item[], today: string): Item[] {
  return items.filter(i => !i.done && !!i.due_date && i.due_date >= today)
    .sort((a,b) => (a.due_date || '').localeCompare(b.due_date || '') || a.title.localeCompare(b.title));
}

/** Preserve the selected day-of-month where possible when changing months. */
export function shiftCalendarMonth(selectedDay: string, offset: number): string {
  const [year, month, day] = selectedDay.split('-').map(Number);
  const target = new Date(year, month - 1 + offset, 1, 12);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  const result = new Date(target.getFullYear(), target.getMonth(), Math.min(day, maxDay), 12);
  return `${result.getFullYear()}-${String(result.getMonth()+1).padStart(2,'0')}-${String(result.getDate()).padStart(2,'0')}`;
}

/** Empty course selection intentionally means personal/general focus. */
export function focusTasksForContext(items: Item[], courseId: string): Item[] {
  return items.filter(item => !item.done && isActionable(item) && (item.course_id || '') === courseId);
}
