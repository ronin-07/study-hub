'use client';

import { memo, useEffect, useState } from 'react';
import { type FocusSession, duration } from '@/lib/types';
import { currentFocusSeconds } from '@/lib/focus-timing';

/** Isolated clock: ticking does not rerender the entire planner/calendar dashboard. */
export const FocusElapsed = memo(function FocusElapsed({session}: {session: FocusSession}) {
  const [epochMs, setEpochMs] = useState(() => Date.now());
  useEffect(() => {
    setEpochMs(Date.now());
    if (session.status !== 'running') return;
    const refresh = () => setEpochMs(previous => {
      const current=Date.now();
      return Math.floor(previous/1000)===Math.floor(current/1000) ? previous : current;
    });
    const interval = window.setInterval(refresh, 250);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [session.status, session.id]);
  return <>{duration(currentFocusSeconds(session, session.status==='paused' ? Math.max(epochMs,(session.pause_started_at??0)*1000) : epochMs))}</>;
});
