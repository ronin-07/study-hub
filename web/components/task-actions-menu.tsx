'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ListChecks, MoreHorizontal, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import type { Item } from '@/lib/types';

type MenuAction = { label: string; icon: LucideIcon; run: () => void; danger?: boolean; title?: string };

/** Shared menu: portalled so rows near a panel edge never clip the actions. */
export function WorkspaceActionsMenu({title,busy,actions,className}: {
  title:string;busy:boolean;actions:MenuAction[];className?:string;
}) {
  const [open,setOpen]=useState(false);
  const [coordinates,setCoordinates]=useState<{top:number;left:number}|null>(null);
  const triggerRef=useRef<HTMLButtonElement|null>(null);
  const menuRef=useRef<HTMLDivElement|null>(null);
  const menuId=useId();
  useLayoutEffect(()=>{
    if(!open)return;
    const trigger=triggerRef.current,menu=menuRef.current;
    if(!trigger||!menu)return;
    const rect=trigger.getBoundingClientRect();
    const menuWidth=menu.offsetWidth,menuHeight=menu.offsetHeight;
    const gap=6,edge=8;
    const left=Math.max(edge,Math.min(rect.right-menuWidth,window.innerWidth-menuWidth-edge));
    const below=rect.bottom+gap;
    const above=rect.top-menuHeight-gap;
    const top=below+menuHeight<=window.innerHeight-edge?below:
      above>=edge?above:Math.max(edge,window.innerHeight-menuHeight-edge);
    setCoordinates({top,left});
  },[open]);
  useEffect(()=>{
    if(open&&coordinates)menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  },[open,coordinates]);
  useEffect(()=>{
    if(!open)return;
    const close=(event?:Event)=>{
      if(event?.type==='scroll'&&event.target instanceof Node&&menuRef.current?.contains(event.target))return;
      setOpen(false);
    };
    const onOutside=(event:PointerEvent)=>{
      if(!menuRef.current?.contains(event.target as Node)&&
        !triggerRef.current?.contains(event.target as Node))close();
    };
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();close();triggerRef.current?.focus();}
      if(event.key==='Tab'){close();triggerRef.current?.focus();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        const entries=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if(!entries.length)return;
        const current=entries.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='Home'?0:event.key==='End'?entries.length-1:
          event.key==='ArrowDown'?(current+1)%entries.length:(current<=0?entries.length-1:current-1);
        entries[next].focus();event.preventDefault();
      }
    };
    document.addEventListener('pointerdown',onOutside);
    document.addEventListener('keydown',onKey);
    window.addEventListener('resize',close);
    window.addEventListener('scroll',close,true);
    return ()=>{
      document.removeEventListener('pointerdown',onOutside);
      document.removeEventListener('keydown',onKey);
      window.removeEventListener('resize',close);
      window.removeEventListener('scroll',close,true);
    };
  },[open]);
  const action=(handler:()=>void)=>()=>{setOpen(false);triggerRef.current?.focus();handler();};
  return <>
    <button type="button" ref={triggerRef} className={className?`icon-btn ${className}`:'icon-btn'} disabled={busy}
      aria-label={`More actions for ${title}`} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open?menuId:undefined} title="More actions" onClick={()=>{setCoordinates(null);setOpen(v=>!v);}}>
      <MoreHorizontal size={17}/>
    </button>
    {open&&typeof document!=='undefined'&&createPortal(<div id={menuId} ref={menuRef}
      className={className?`planner-task-floating-menu ${className}-panel`:'planner-task-floating-menu'} role="menu" aria-label={`Actions for ${title}`}
      style={{top:coordinates?.top??0,left:coordinates?.left??0,visibility:coordinates?'visible':'hidden'}}>
      {actions.map(({label,icon:Icon,run,danger,title:tooltip})=><button key={label} type="button" role="menuitem"
        tabIndex={-1} title={tooltip} className={danger?'danger':undefined} disabled={busy} onClick={action(run)}><Icon size={14} aria-hidden="true"/> {label}</button>)}
    </div>,document.querySelector('.app-shell')??document.body)}
  </>;
}

export function TaskActionsMenu({item,busy,onEdit,onPlan,onRemove,onDelete}: {
  item:Item;busy:boolean;onEdit:()=>void;onPlan:()=>void;onRemove?:()=>void;onDelete:()=>void;
}) {
  return <WorkspaceActionsMenu title={item.title} busy={busy} actions={[
    {label:'Edit task',icon:Pencil,run:onEdit},
    {label:'Plan or reschedule',icon:CalendarDays,run:onPlan},
    ...(onRemove?[{label:'Remove from Tasks',icon:ListChecks,run:onRemove}]:[]),
    {label:'Delete permanently',icon:Trash2,run:onDelete,danger:true},
  ]}/>;
}
