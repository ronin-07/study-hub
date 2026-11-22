'use client';

import { ArrowRight, BookOpen, CalendarDays, ListTodo, Plus, Library, type LucideIcon } from 'lucide-react';

type EmptyScene = 'home' | 'study' | 'tasks' | 'calendar' | 'resources';
const sceneIcons: Record<EmptyScene, LucideIcon> = {
  home: ListTodo,
  study: BookOpen,
  tasks: ListTodo,
  calendar: CalendarDays,
  resources: Library,
};

/** Only render for a genuinely empty section. The CSS photo is a direct public asset;
 * the plum gradient remains readable if a photo request fails or is unavailable. */
export function PhotoEmptyState({scene,title,detail,actionLabel,onAction,secondaryLabel,onSecondary,compact=false}:{
  scene:EmptyScene;title:string;detail:string;actionLabel?:string;onAction?:()=>void;
  secondaryLabel?:string;onSecondary?:()=>void;compact?:boolean;
}) {
  const Icon=sceneIcons[scene];
  return <section className={'photo-empty-state photo-empty-'+scene+(compact?' compact':'')}>
    <div className="photo-empty-backdrop" aria-hidden="true"/>
    <div className="photo-empty-content">
      <div className="photo-empty-icon"><Icon size={20} aria-hidden="true"/></div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {((actionLabel&&onAction)||(secondaryLabel&&onSecondary))&&<div className="photo-empty-actions">
        {actionLabel&&onAction&&<button type="button" className="photo-empty-primary" onClick={onAction}><Plus size={15} aria-hidden="true"/>{actionLabel}</button>}
        {secondaryLabel&&onSecondary&&<button type="button" className="photo-empty-secondary" onClick={onSecondary}>{secondaryLabel}<ArrowRight size={14} aria-hidden="true"/></button>}
      </div>}
    </div>
  </section>;
}
