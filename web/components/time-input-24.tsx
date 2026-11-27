'use client';
import {useId} from 'react';
import {X} from 'lucide-react';
import {changeClockPart} from '@/lib/clock';

const options=(count:number)=>Array.from({length:count},(_,i)=>String(i).padStart(2,'0'));
const hours=options(24),minutes=options(60);

export function TimeInput24({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const labelId=useId();
  const [hour='',minute='']=value.split(':');
  return <div className="form-row" role="group" aria-labelledby={labelId}>
    <span id={labelId}>Exam start time (optional)</span>
    <div className="time-input-24">
      <select aria-label="Exam start hour (24-hour)" value={hour} onChange={e=>onChange(changeClockPart(value,'hour',e.target.value))}>
        <option value="">HH</option>{hours.map(h=><option key={h} value={h}>{h}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label="Exam start minute" value={minute} onChange={e=>onChange(changeClockPart(value,'minute',e.target.value))}>
        <option value="">MM</option>{minutes.map(m=><option key={m} value={m}>{m}</option>)}
      </select>
      <button type="button" className="icon-btn" aria-label="Clear exam start time" title="Clear exam start time" disabled={!value} onClick={()=>onChange('')}><X size={15}/></button>
    </div>
  </div>;
}
