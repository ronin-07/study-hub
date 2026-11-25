/** Read-only projections for the v0.5 Home dashboard. No duplicated task records. */
import type { Course, Item } from './types';
import { isActionable, isOverdue, todayPriorities } from './task-view.ts';

export type TodayCourse = {
  course: Course;
  tasks: Item[];
  weekNumbers: number[];
  overdueCount: number;
  doneCount: number;
  activityCount: number;
  todayCount: number;
};

/** Completion dates use the same local calendar as planned/due dates. */
export function completedHomePriorities(items: Item[], today: string): Item[] {
  return items.filter(i => {
    if (!i.done || !isActionable(i) || i.completed_at == null) return false;
    if (!(i.planned_date && i.planned_date <= today) && !(i.due_date && i.due_date <= today)) return false;
    const d = new Date(i.completed_at * 1000);
    const local = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    return local === today;
  }).sort((a,b) => b.completed_at! - a.completed_at! || a.title.localeCompare(b.title));
}

/** One card per active course; open and completed-today work share a denominator. */
export function todayStudyCourses(courses: Course[], items: Item[], today: string): TodayCourse[] {
  const active = new Map(courses.filter(c => !c.archived).map(c => [c.id, c]));
  const actionable = items.filter(isActionable);
  const work = todayPriorities(actionable, today);
  const completed = completedHomePriorities(actionable, today);
  // Preserve today's explicitly scheduled work, including legacy completed rows.
  const scheduledToday = actionable.filter(i => i.planned_date === today || i.due_date === today);
  const cohort = new Map([...work, ...completed, ...scheduledToday].map(i => [i.id, i]));
  const grouped = new Map<string, Item[]>();
  for (const task of cohort.values()) {
    if (!task.course_id || !active.has(task.course_id)) continue;
    grouped.set(task.course_id, [...(grouped.get(task.course_id) || []), task]);
  }
  return [...grouped].map(([id, progressTasks]) => {
    const tasks = progressTasks.filter(i => !i.done);
    const weeks = [...new Set(progressTasks.map(t => t.week_number).filter((n): n is number => n != null))].sort((a,b) => a-b);
    return {
      course: active.get(id)!, tasks, weekNumbers: weeks,
      overdueCount: tasks.filter(t => isOverdue(t, today)).length,
      doneCount: progressTasks.filter(i => i.done).length,
      activityCount: progressTasks.length,
      todayCount: progressTasks.filter(i => i.planned_date === today || i.due_date === today).length
    };
  }).sort((a,b) => b.overdueCount-a.overdueCount || b.tasks.length-a.tasks.length || a.course.code.localeCompare(b.course.code));
}

export type CalendarDay = {date: string; weekday: string; day: number; count: number};
export function nextSevenDays(today: string, items: Item[]): CalendarDay[] {
  const [year, month, day] = today.split('-').map(Number);
  const start = new Date(year, month-1, day, 12); // local noon avoids DST day skips
  return Array.from({length:7},(_,offset) => {
    const d = new Date(start);d.setDate(start.getDate()+offset);
    const date = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    return {date,weekday:new Intl.DateTimeFormat('en-GB',{weekday:'short'}).format(d),day:d.getDate(),
      count:items.filter(i => !i.done && (i.planned_date === date || i.due_date === date)).length};
  });
}

export function nextDeadlineDays(today: string, dueDate: string): number {
  const asUTC = (value:string) => {
    const [y,m,d] = value.split('-').map(Number);
    return Date.UTC(y,m-1,d);
  };
  return Math.round((asUTC(dueDate)-asUTC(today))/86400000);
}

/** Compact Home agenda; each item appears once even if both planned and due here. */
export type DayAgendaEntry = { item: Item; reason: 'planned-and-due' | 'planned' | 'due' };
export function agendaForDate(items: Item[], date: string): DayAgendaEntry[] {
  const weight = {high:0,medium:1,low:2};
  return items.filter(i=>!i.done && (i.planned_date===date || i.due_date===date))
    .map(item=>({item,reason: item.planned_date===date && item.due_date===date
      ? 'planned-and-due' as const : item.planned_date===date ? 'planned' as const : 'due' as const}))
    .sort((a,b)=>weight[a.item.priority]-weight[b.item.priority] || a.item.title.localeCompare(b.item.title));
}
