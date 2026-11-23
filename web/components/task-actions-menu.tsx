'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ListChecks, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { Item } from '@/lib/types';

/** Shared menu: portalled so rows near a panel edge never clip the actions. */
export function TaskActionsMenu({item,busy,onEdit,onPlan,onRemove,onDelete}: {
  item:Item;busy:boolean;onEdit:()=>void;onPlan:()=>void;onRemove?:()=>void;onDelete:()=>void;
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
    const close=()=>setOpen(false);
    const onOutside=(event:PointerEvent)=>{
      if(!menuRef.current?.contains(event.target as Node)&&
        !triggerRef.current?.contains(event.target as Node))close();
    };
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();close();triggerRef.current?.focus();}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        const entries=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if(!entries.length)return;
        const current=entries.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='ArrowDown'?(current+1)%entries.length:(current-1+entries.length)%entries.length;
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
  const action=(handler:()=>void)=>()=>{setOpen(false);handler();};
  return <>
    <button type="button" ref={triggerRef} className="icon-btn" disabled={busy}
      aria-label={`More actions for ${item.title}`} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open?menuId:undefined} title="More actions" onClick={()=>{setCoordinates(null);setOpen(v=>!v);}}>
      <MoreHorizontal size={17}/>
    </button>
    {open&&typeof document!=='undefined'&&createPortal(<div id={menuId} ref={menuRef}
      className="planner-task-floating-menu" role="menu" aria-label={`Actions for ${item.title}`}
      style={{top:coordinates?.top??0,left:coordinates?.left??0,visibility:coordinates?'visible':'hidden'}}>
      <button type="button" role="menuitem" disabled={busy} onClick={action(onEdit)}><Pencil size={14}/> Edit task</button>
      <button type="button" role="menuitem" disabled={busy} onClick={action(onPlan)}><CalendarDays size={14}/> Plan or reschedule</button>
      {onRemove&&<button type="button" role="menuitem" disabled={busy} onClick={action(onRemove)}><ListChecks size={14}/> Remove from Tasks</button>}
      <button type="button" role="menuitem" className="danger" disabled={busy} onClick={action(onDelete)}><Trash2 size={14}/> Delete permanently</button>
    </div>,document.querySelector('.app-shell')??document.body)}
  </>;
}
