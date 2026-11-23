'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Fixed, viewport-aware profile tooltip. The sidebar itself can be resized or
 * scrollable, so a CSS pseudo-element can otherwise be cut off at its edge.
 */
export function ProfileName({name}:{name:string}) {
  const id=useId();
  const anchor=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState<{left:number;top:number}|null>(null);
  const show=()=>{
    const rect=anchor.current?.getBoundingClientRect();
    if(!rect)return;
    setPosition({left:Math.min(Math.max(12,rect.left),Math.max(12,window.innerWidth-332)),top:Math.max(52,rect.top-9)});
  };
  useEffect(()=>{
    if(!position)return;
    const hide=()=>setPosition(null);
    window.addEventListener('scroll',hide,true);
    window.addEventListener('resize',hide);
    return ()=>{window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide);};
  },[position]);
  return <>
    <div ref={anchor} className="sidebar-profile-copy" tabIndex={0}
      aria-label={`Account: ${name}`} aria-describedby={position?id:undefined}
      onPointerEnter={show} onPointerLeave={()=>setPosition(null)} onFocus={show} onBlur={()=>setPosition(null)}>
      <strong>{name}</strong><small>DTU student</small>
    </div>
    {position&&typeof document!=='undefined'&&createPortal(<div id={id} className="sidebar-profile-tooltip" role="tooltip" style={position}>{name}</div>,document.body)}
  </>;
}
