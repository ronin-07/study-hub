'use client';
import { focusDurationParts, setFocusDurationPart } from '@/lib/focus-display';

/** Three accessible fields backed by the same exact-second value used by the backend. */
export function FocusDurationFields({ seconds, maximum, onChange }: {
  seconds: string; maximum: number; onChange: (seconds: string) => void;
}) {
  const total = Number(seconds) || 0;
  const values = focusDurationParts(total);
  return <fieldset className="focus-duration-fields">
    <legend>Counted focus time</legend>
    {(['hours','minutes','seconds'] as const).map(part=><label key={part}>
      <input type="number" inputMode="numeric" min={0} max={part==='hours'?24:59}
        aria-label={`Counted focus ${part}`} value={values[part]}
        onChange={e=>onChange(String(setFocusDurationPart(total,part,e.target.value,maximum)))}/>
      <span>{part[0].toUpperCase()+part.slice(1)}</span>
    </label>)}
  </fieldset>;
}
