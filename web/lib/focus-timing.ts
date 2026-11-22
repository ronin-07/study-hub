import { type FocusSession, elapsedFocus } from './types.ts';

/** Optimistic transitions are local previews only; the API remains authoritative. */
export function previewPause(session: FocusSession, nowSeconds: number): FocusSession {
  if (session.status !== 'running') return session;
  return { ...session, status: 'paused', pause_started_at: nowSeconds };
}

export function previewResume(session: FocusSession, nowSeconds: number): FocusSession {
  if (session.status !== 'paused') return session;
  return {
    ...session, status: 'running',
    accumulated_pause_seconds: session.accumulated_pause_seconds + Math.max(0, nowSeconds - (session.pause_started_at ?? nowSeconds)),
    pause_started_at: null,
  };
}

/** Use real wall time rather than counting timer callbacks (background tabs throttle timers). */
export function currentFocusSeconds(session: FocusSession, epochMs: number): number {
  return elapsedFocus(session, Math.floor(epochMs / 1000));
}

export function sessionReviewLimit(session: FocusSession, epochMs: number): number {
  return Math.min(86400, currentFocusSeconds(session, epochMs));
}
