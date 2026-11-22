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


/**
 * A local UI anchor, shared by the header and Focus page. Backend timestamps
 * are whole seconds, so using them as the display clock after each POST causes
 * 21 → 22 → 21 jumps. This anchor is NOT the source of truth for persisted time.
 */
export type FocusClockAnchor = {
  sessionId: string;
  status: 'running' | 'paused';
  elapsedMs: number;
  wallAnchorMs: number;
  monoAnchorMs: number;
};

/** Recover an existing session from Firestore on first load or external changes. */
export function recoverFocusClock(session: FocusSession, wallMs: number, monoMs: number): FocusClockAnchor {
  return {
    sessionId: session.id,
    status: session.status === 'running' ? 'running' : 'paused',
    elapsedMs: currentFocusSeconds(session, wallMs) * 1000,
    wallAnchorMs: wallMs,
    monoAnchorMs: monoMs,
  };
}

export function startFocusClock(sessionId: string, wallMs: number, monoMs: number): FocusClockAnchor {
  return { sessionId, status: 'running', elapsedMs: 0, wallAnchorMs: wallMs, monoAnchorMs: monoMs };
}

/**
 * Foreground time uses a monotonic clock; wall-clock time also covers laptop
 * sleep on platforms where the monotonic clock pauses. Never move backward if
 * the system clock is adjusted backward while a session is running.
 */
export function focusClockElapsedMs(clock: FocusClockAnchor, wallMs: number, monoMs: number): number {
  if (clock.status === 'paused') return clock.elapsedMs;
  const elapsedWall = Math.max(0, wallMs - clock.wallAnchorMs);
  const elapsedMono = Math.max(0, monoMs - clock.monoAnchorMs);
  return clock.elapsedMs + Math.max(elapsedWall, elapsedMono);
}

export function focusClockSeconds(clock: FocusClockAnchor, wallMs: number, monoMs: number): number {
  return Math.floor(focusClockElapsedMs(clock, wallMs, monoMs) / 1000);
}

/** Freeze the full second that was visible when the user clicked Pause/End. */
export function pauseFocusClock(clock: FocusClockAnchor, wallMs: number, monoMs: number): FocusClockAnchor {
  if (clock.status === 'paused') return clock;
  const displayedSeconds = focusClockSeconds(clock, wallMs, monoMs);
  return {
    ...clock, status: 'paused', elapsedMs: displayedSeconds * 1000,
    wallAnchorMs: wallMs, monoAnchorMs: monoMs,
  };
}

/** A new visible second appears exactly 1000ms after the Resume click. */
export function resumeFocusClock(clock: FocusClockAnchor, wallMs: number, monoMs: number): FocusClockAnchor {
  if (clock.status === 'running') return clock;
  return { ...clock, status: 'running', wallAnchorMs: wallMs, monoAnchorMs: monoMs };
}

export function rekeyFocusClock(clock: FocusClockAnchor, sessionId: string): FocusClockAnchor {
  return { ...clock, sessionId };
}

/** Dynamic ring: a timed session fills once; stopwatch loops each minute. */
export function focusClockProgress(clock: FocusClockAnchor, mode: FocusSession['mode'], wallMs: number, monoMs: number): number {
  const milliseconds = focusClockElapsedMs(clock, wallMs, monoMs);
  if (mode === 'free') return (milliseconds % 60_000) / 60_000;
  return Math.min(1, milliseconds / (Number(mode) * 60_000));
}
