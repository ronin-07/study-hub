'use client';

import Image from 'next/image';
import { ArrowRight, BookOpen, CalendarDays, ListTodo, Plus, Library, type LucideIcon } from 'lucide-react';

type EmptyScene = 'home' | 'study' | 'tasks' | 'calendar' | 'resources';
const scenes: Record<EmptyScene, {src:string;icon:LucideIcon}> = {
  home: {src:'/empty-states/home.webp',icon:ListTodo},
  study: {src:'/empty-states/study.webp',icon:BookOpen},
  tasks: {src:'/empty-states/tasks.webp',icon:ListTodo},
  calendar: {src:'/empty-states/calendar.webp',icon:CalendarDays},
  resources: {src:'/empty-states/resources.webp',icon:Library},
};

/** Photographs appear only when a section genuinely has no content. */
export function PhotoEmptyState({scene,title,detail,actionLabel,onAction,secondaryLabel,onSecondary,compact=false}:{
  scene:EmptyScene;title:string;detail:string;actionLabel?:string;onAction?:()=>void;
  secondaryLabel?:string;onSecondary?:()=>void;compact?:boolean;
}) {
  const {src,icon:Icon}=scenes[scene];
  return <div className={'photo-empty-state photo-empty-'+scene+(compact?' compact':'')}>
    <div className="photo-empty-media" aria-hidden="true">
      <Image src={src} alt="" fill sizes={compact?'(max-width: 640px) 100vw, 360px':'(max-width: 640px) 100vw, 560px'} className="photo-empty-img"/>
    </div>
    <div className="photo-empty-content">
      <div className="photo-empty-icon"><Icon size={19} aria-hidden="true"/></div>
      <h3>{title}</h3><p>{detail}</p>
      {(actionLabel&&onAction||secondaryLabel&&onSecondary)&&<div className="photo-empty-actions">
        {actionLabel&&onAction&&<button type="button" className="photo-empty-primary" onClick={onAction}><Plus size={15} aria-hidden="true"/>{actionLabel}</button>}
        {secondaryLabel&&onSecondary&&<button type="button" className="photo-empty-secondary" onClick={onSecondary}>{secondaryLabel}<ArrowRight size={14} aria-hidden="true"/></button>}
      </div>}
    </div>
  </div>;
}
