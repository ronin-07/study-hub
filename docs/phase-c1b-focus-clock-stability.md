# Study Hub v0.5 — Phase C1b: Stable Focus Timer and Live Progress Ring

Baseline: **Phase C1** (`studyhub-v0.5-phase-C1-focus-performance.zip`) on `feature/v0.5-tasks-calendar`. This is a changed-files-only increment. Apply *after* C1; do not merge `main` or use Production Firebase to test.

## Reported defects and root cause

- The previous stopwatch recomputed `Math.floor(Date.now()/1000)` against Firestore session timestamps (also whole seconds). Fractional seconds at Start, Pause, Resume, and API acknowledgment could differ, causing one-second skips and a `21 → 22 → 21` visual jump.
- The header and Focus page previously had separate 250ms polling loops, whose updates could show different seconds briefly.
- The circular dial used a fixed `conic-gradient`: it was **not** an elapsed-time animation.

## Fix

1. The browser now owns a **single high-resolution UI anchor** for the active session, shared by header and Focus page. It starts at 0 at the Start click, stops at the exact whole second visible when Pause/End is clicked, and resumes from that same value with a new full second. It uses monotonic and wall-clock deltas to cover event-loop throttling and laptop sleep.
2. Server responses are **not** used to reset that anchor after each local transition. When the pending Start session gets a real backend ID, the UI anchor is re-keyed without resetting its accumulated time. Existing sessions recovered after a reload use server timestamps as the initial baseline. A remote/external status change may legitimately re-anchor on the next snapshot.
3. Resume passes a bounded click timestamp (`requested_at`) to the backend, matching the existing five-second Start request allowance; network latency does not extend the server-counted pause. The server remains authoritative for persisted duration and validation. The previous no-body Resume endpoint remains compatible.
4. One shared **100ms ticker** drives the header digits and Focus-page dial using `useSyncExternalStore`. Only these small timer components redraw, not the whole Study Hub. Background timers can be throttled by browsers; on visibility restore, the display catches up to true elapsed time.
5. The circular progress arc is now dynamic: fixed 25/50/90-minute modes fill toward their target and stop at 100%; stopwatch mode loops the arc every 60 seconds. Pause freezes the arc immediately. The app's existing visual design remains in place.
6. On **Finish & review**, the display freezes instantly. If backend validation must correct an overcount (e.g. a skewed device clock), the confirmed, lower authoritative duration is shown instead of saving inaccurate time.

## Validation run in the packaging environment

- `cd web && npm test`: **80/80 passed** (including second-boundary, pause, resume, ring animation, sleep, recovery tests).
- `cd backend && python -m pytest -q`: **89 passed, 1 skipped** (skipped test requires Firestore SDK).
- Python compileall and credential scan: passed.
- TS/TSX syntax parse and TypeScript transpilation: passed.
- Full `npm run lint` / `npm run build`: **not verified**. The container's `node_modules/@types` folders are empty, causing TS2688; run `npm ci`, `npm run lint`, and `npm run build` in your Windows environment / GitHub Actions.
- Vercel Preview integration and actual Firebase latency: **not tested** by this package. Do not claim release readiness until checked.

## Focused Vercel Preview checklist

1. Start a Stopwatch three times (finish each session before next). Each start reads `00:00:00` for ~1 full second, then `00:00:01`, `00:00:02`, etc. Never start at 1 or jump to 2 immediately.
2. Pause at 21 seconds: the top-bar chip and Focus page freeze at `00:00:21`, without briefly showing 22 or returning from 22 to 21.
3. Wait 5 seconds, Resume: it remains at 21 for one new second then shows 22, 23, etc. Repeat twice.
4. Slow down requests with browser DevTools Network throttling. Start, Pause and Resume should act immediately locally; a successful response must not reset or rewind the seconds. Offline requests should show an error and roll back to authoritative session status.
5. Verify **End & review** freezes the seconds and Save persists the chosen value. Cancel leaves the timer paused.
6. On Focus page, check the arc smoothly advances while running and freezes while paused. In Stopwatch mode it completes a 60-second revolution; in 25/50/90-minute modes it represents target completion.
7. Switch browser tabs/put Windows to sleep, then return: elapsed time catches up. Browser throttling may skip visible frames while hidden, but accumulated time is correct.
8. In two browser tabs, verify only one active Focus session can exist (Phase B guard), and refresh synchronizes a session changed elsewhere.
9. Run `npm ci`, `npm test`, `npm run lint`, `npm run build` locally, verify GitHub Actions green, and inspect the Vercel Preview deployment before proceeding.
