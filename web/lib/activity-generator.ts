import type { Item, Kind } from './types';

export type ActivityDefinition = {title:string; kind:Exclude<Kind,'personal'>};
export type ActivityChoice = ActivityDefinition & {selected:boolean};
export type GenerationResult = {created:number; skipped:number; items:Item[]};
export const MAX_ACTIVITY_TYPES = 10;
export const defaultActivities: ActivityDefinition[] = [
  {title:'Lecture slides',kind:'lecture'}, {title:'Book reading',kind:'reading'},
  {title:'Book questions',kind:'questions'}, {title:'Past year questions',kind:'questions'},
  {title:'Assignments',kind:'assignment'}, {title:'Exercises',kind:'exercise'},
];
export const normalizedActivityName = (title:string) => title.trim().replace(/\s+/gu,' ').toLowerCase();
export const teachingWeeks = (count:number) => Array.from({length:count},(_,i)=>i+1);
export function generationSummary(items:Item[], courseId:string, activities:ActivityDefinition[], weeks:number[]) {
  const existing = new Set(items.filter(i=>i.course_id===courseId && i.week_number!=null)
    .map(i=>`${i.week_number}:${normalizedActivityName(i.title)}`));
  let skipped=0;
  for(const week of weeks) for(const activity of activities) {
    if(existing.has(`${week}:${normalizedActivityName(activity.title)}`)) skipped++;
  }
  const potential=activities.length*weeks.length;
  return {potential, skipped, created:potential-skipped};
}
