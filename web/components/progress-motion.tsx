'use client';

import { useEffect, useRef, useState } from 'react';
import { clampPercent, easedProgress, PROGRESS_ANIMATION_MS, reachedMilestone } from '@/lib/progress-presentation';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Animate only the number, never the parent card or underlying task state. */
export function ProgressValue({value, suffix='%', decimals=0}: {
  value: number; suffix?: string; decimals?: number;
}) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const previousRef = useRef(value);
  useEffect(() => {
    if (previousRef.current === value) return;
    previousRef.current = value;
    if (prefersReducedMotion()) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = easedProgress(from, value, (now - start) / PROGRESS_ANIMATION_MS);
      shownRef.current = next;
      setShown(next);
      if (now - start < PROGRESS_ANIMATION_MS) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  const format = (n: number) => `${decimals ? n.toFixed(decimals) : Math.round(n)}${suffix}`;
  return <span className="progress-animated-number">
    <span aria-hidden="true">{format(shown)}</span>
    <span className="progress-visually-hidden">{format(value)}</span>
  </span>;
}

/** Uses the existing track appearance, with a milestone effect only on real updates. */
export function ProgressTrack({value, label, className='progress-track', identity='default', completionMessage}: {
  value: number; label: string; className?: string; identity?: string; completionMessage?: string;
}) {
  const percentage = clampPercent(value);
  const previousRef = useRef({identity, percentage});
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = {identity, percentage};
    if (previous.identity !== identity) {
      setCelebrating(false);
      return;
    }
    if (!reachedMilestone(previous.percentage, percentage)) {
      setCelebrating(false);
      return;
    }
    setCelebrating(true);
    const timeout = window.setTimeout(() => setCelebrating(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [percentage, identity]);
  return <><div className={`${className} progress-motion-track${percentage===100?' progress-complete':''}${celebrating&&!prefersReducedMotion()?' progress-celebrating':''}`}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
    <div style={{width:'100%',transform:`scaleX(${percentage/100})`}}/>
  </div>{completionMessage&&<small className="exam-completion-message" role="status">{celebrating?completionMessage:''}</small>}</>;
}
