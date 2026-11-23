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

/** One card per active course, even when today's items span several teaching weeks. */
export function todayStudyCourses(courses: Course[], items: Item[], today: string): TodayCourse[] {
  const active = new Map(courses.filter(c => !c.archived).map(c => [c.id, c]));
  const work = todayPriorities(items.filter(isActionable), today);
  // Today's schedule includes already-completed items, so checking the last
  // task does not make the course card disappear or reset its progress.
  const scheduledToday = items.filter(i => isActionable(i) &&
    (i.planned_date === today || i.due_date === today));
  const grouped = new Map<string, Item[]>();
  for (const task of work) {
    if (!task.course_id || !active.has(task.course_id)) continue;
    grouped.set(task.course_id, [...(grouped.get(task.course_id) || []), task]);
  }
  for (const task of scheduledToday) {
    if (task.course_id && active.has(task.course_id) && !grouped.has(task.course_id)) grouped.set(task.course_id, []);
  }
  return [...grouped].map(([id, tasks]) => {
    const todayTasks = scheduledToday.filter(i => i.course_id === id);
    const contextTasks = [...todayTasks, ...tasks];
    const weeks = [...new Set(contextTasks.map(t => t.week_number).filter((n): n is number => n != null))].sort((a,b) => a-b);
    // Daily progress only counts work actually scheduled for today. Overdue-
    // only courses instead show catch-up progress for their open work.
    const progressTasks = todayTasks.length ? todayTasks : tasks;
    return {
      course: active.get(id)!, tasks, weekNumbers: weeks,
      overdueCount: tasks.filter(t => isOverdue(t, today)).length,
      doneCount: progressTasks.filter(i => i.done).length,
      activityCount: progressTasks.length,
      todayCount: todayTasks.length
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
