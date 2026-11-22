'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ListTodo, MoreHorizontal, Timer } from 'lucide-react';

/** Portal prevents the horizontally scrolling Home course carousel from clipping menus. */
export function CourseActionsMenu({courseId,courseTitle,onViewTasks,onFocus,onLibrary}:{
  courseId:string;courseTitle:string;onViewTasks:()=>void;onFocus:()=>void;onLibrary:()=>void;
}){
  const [open,setOpen]=useState(false);
  const [position,setPosition]=useState<{top:number;left:number;above:boolean}|null>(null);
  const buttonRef=useRef<HTMLButtonElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const menuId='course-actions-'+courseId.replace(/[^a-zA-Z0-9]/g,'-');
  useEffect(()=>{
    if(!open)return;
    const reposition=()=>{
      const button=buttonRef.current;
      if(!button)return;
      const rect=button.getBoundingClientRect();
      const menuWidth=210,menuHeight=152,pad=12;
      const above=window.innerHeight-rect.bottom<menuHeight+pad && rect.top>menuHeight+pad;
      setPosition({top:above?rect.top-8:rect.bottom+8,left:Math.max(pad,Math.min(rect.right-menuWidth,window.innerWidth-menuWidth-pad)),above});
    };
    const dismiss=(event:PointerEvent)=>{
      if(!menuRef.current?.contains(event.target as Node)&&!buttonRef.current?.contains(event.target as Node))setOpen(false);
    };
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);buttonRef.current?.focus();}};
    const onScroll=(event:Event)=>{
      if(menuRef.current?.contains(event.target as Node))return;
      setOpen(false);
    };
    reposition();
    document.addEventListener('pointerdown',dismiss);
    document.addEventListener('keydown',onKey);
    window.addEventListener('resize',reposition);
    window.addEventListener('scroll',onScroll,true);
    return ()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',onKey);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',onScroll,true);};
  },[open]);
  useEffect(()=>{if(open&&position)menuRef.current?.querySelector('button')?.focus();},[open,position]);
  const menuKeyDown=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();
    const buttons=Array.from(menuRef.current?.querySelectorAll('button')||[]);
    const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(current+1)%buttons.length:(current+buttons.length-1)%buttons.length;
    buttons[next]?.focus();
  };
  const act=(fn:()=>void)=>{setOpen(false);fn();};
  const target=buttonRef.current?.closest('.app-shell');
  return <>
    <button ref={buttonRef} type="button" className="home-subtle-button" aria-label={`More actions for ${courseTitle}`} title="Course actions" aria-expanded={open} aria-haspopup="menu" aria-controls={open?menuId:undefined} onClick={()=>setOpen(value=>!value)}><MoreHorizontal size={20}/></button>
    {open&&position&&target&&createPortal(<div ref={menuRef} id={menuId} className="home-course-menu" role="menu" onKeyDown={menuKeyDown} aria-label={`Actions for ${courseTitle}`} style={{top:position.top,left:position.left,transform:position.above?'translateY(-100%)':undefined}}>
      <button role="menuitem" type="button" onClick={()=>act(onViewTasks)}><ListTodo size={16}/> View course tasks</button>
      <button role="menuitem" type="button" onClick={()=>act(onFocus)}><Timer size={16}/> Start focus session</button>
      <button role="menuitem" type="button" onClick={()=>act(onLibrary)}><BookOpen size={16}/> Open course library</button>
    </div>,target)}
  </>;
}
