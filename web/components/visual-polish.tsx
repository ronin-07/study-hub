'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';

/** Animate progress changes, but never loop or animate the initial value. */
export function AnimatedPercent({ value, className = '' }: { value: number; className?: string }) {
  const target = Math.max(0, Math.min(100, Math.round(value)));
  const [visible, setVisible] = useState(target);
  const visibleRef = useRef(target);
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || document.hidden) {
      visibleRef.current = target;
      setVisible(target);
      return;
    }
    const startValue = visibleRef.current;
    if (startValue === target) return;
    let frame = 0;
    let started: number | null = null;
    const tick = (now: number) => {
      if (started === null) started = now;
      const t = Math.min(1, (now - started) / 480);
      const ease = 1 - Math.pow(1 - t, 3);
      const result = Math.round(startValue + (target - startValue) * ease);
      visibleRef.current = result;
      setVisible(result);
      if (t < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [target]);
  return <span className={className} aria-label={`${target} percent`}>{visible}%</span>;
}

export type Feedback = { tone: 'saving' | 'success' | 'error'; message: string };

export function SaveFeedback({ feedback, onDismiss }: { feedback: Feedback | null; onDismiss: () => void }) {
  if (!feedback) return null;
  const Icon = feedback.tone === 'saving' ? LoaderCircle : feedback.tone === 'success' ? CheckCircle2 : AlertCircle;
  return <div className={`study-save-feedback ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'} aria-live={feedback.tone === 'error' ? 'assertive' : 'polite'}>
    <Icon size={17} className={feedback.tone === 'saving' ? 'spin' : undefined} aria-hidden="true"/>
    <span>{feedback.message}</span>
    {feedback.tone !== 'saving' && <button type="button" onClick={onDismiss} aria-label="Dismiss notification"><X size={15}/></button>}
  </div>;
}
