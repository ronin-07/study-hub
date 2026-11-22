'use client';

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { type FocusSession, duration } from '@/lib/types';
import {
  type FocusClockAnchor, recoverFocusClock, focusClockSeconds, focusClockDisplaySeconds, focusClockProgress,
} from '@/lib/focus-timing';

function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

type FocusTick = {wallMs:number; monoMs:number};
const serverTick: FocusTick = {wallMs:0, monoMs:0};
let tick: FocusTick = {wallMs:Date.now(), monoMs:monotonicNow()};
const listeners = new Set<() => void>();
let interval: number | null = null;

function publishTick() {
  tick = {wallMs:Date.now(), monoMs:monotonicNow()};
  listeners.forEach(listener => listener());
}

/** One shared 100ms ticker for both readouts, independent of the main Page. */
function subscribeToTick(listener: () => void) {
  listeners.add(listener);
  if (interval === null) {
    interval = window.setInterval(publishTick, 100);
    document.addEventListener('visibilitychange', publishTick);
    publishTick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval !== null) {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', publishTick);
      interval = null;
    }
  };
}
const noSubscription = () => () => {};
const getTick = () => tick;
const getServerTick = () => serverTick;

/** Only the timer children subscribe: nothing else rerenders every 100ms. */
function useClockSample(session: FocusSession, anchor: FocusClockAnchor | null) {
  const recovered = useMemo(
    () => recoverFocusClock(session, Date.now(), monotonicNow()),
    [session.id, session.status, session.started_at, session.pause_started_at,
      session.accumulated_pause_seconds, session.ended_at],
  );
  const clock = anchor?.sessionId === session.id && anchor.status === session.status ? anchor : recovered;
  const sample = useSyncExternalStore(clock.status==='running'?subscribeToTick:noSubscription,
    getTick, getServerTick);
  return { clock, wallMs:sample.wallMs, monoMs:sample.monoMs };
}

export const FocusElapsed = memo(function FocusElapsed({session, anchor}: {
  session: FocusSession; anchor: FocusClockAnchor | null;
}) {
  const {clock, wallMs, monoMs} = useClockSample(session, anchor);
  return <>{duration(focusClockDisplaySeconds(clock, session.mode, wallMs, monoMs))}</>;
});

export const FocusDial = memo(function FocusDial({session, anchor}: {
  session: FocusSession; anchor: FocusClockAnchor | null;
}) {
  const {clock, wallMs, monoMs} = useClockSample(session, anchor);
  const elapsedSeconds = focusClockSeconds(clock, wallMs, monoMs);
  const displaySeconds = focusClockDisplaySeconds(clock, session.mode, wallMs, monoMs);
  const targetReached = session.mode !== 'free' && elapsedSeconds >= Number(session.mode) * 60;
  // Track crossings, not renders: a session already at its target must not celebrate on mount.
  const previousTarget = useRef({sessionId:session.id, reached:targetReached});
  const [targetCelebrating, setTargetCelebrating] = useState(false);
  useEffect(() => {
    const previous = previousTarget.current;
    previousTarget.current = {sessionId:session.id, reached:targetReached};
    if (previous.sessionId !== session.id) {setTargetCelebrating(false);return;}
    if (previous.reached || !targetReached) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setTargetCelebrating(true);
    const timeout = window.setTimeout(() => setTargetCelebrating(false), 2100);
    return () => window.clearTimeout(timeout);
  }, [session.id, targetReached]);
  const progress = focusClockProgress(clock, session.mode, wallMs, monoMs);
  const style = {'--focus-progress': `${(progress * 100).toFixed(2)}%`} as CSSProperties;
  return <div className={'timer-dial focus-dial-progress'+(targetCelebrating?' focus-target-celebrating':'')} style={style}
    role="timer" aria-label={`Focus timer ${clock.status}, ${duration(displaySeconds)} ${session.mode === 'free' ? 'elapsed' : 'remaining'}`} >
    <span className="dial-label">{clock.status==='paused'?'PAUSED':targetReached?'TARGET REACHED':'FOCUSING'}</span>
    <strong>{duration(displaySeconds)}</strong>
    <span className="dial-sub">{session.mode==='free'?'Count-up session':targetReached?'Target reached · finish when ready':'Time remaining'}</span>
  </div>;
});
