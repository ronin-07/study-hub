# Study Hub v0.5 — Phase C1: Focus responsiveness and render performance

Baseline: Phase B2, branch `feature/v0.5-tasks-calendar`. Apply this changed-file ZIP only after Phase A, corrected B1, and B2. No database reset required for these backward-compatible fields.

## Problem fixed

Formerly the End Session button only opened a review dialog; the session continued ticking until the final POST. The entire `app/page.tsx` component also updated every second, requiring expensive course/task/calendar recomputation even when Focus was the only moving element. Start/pause/resume changes were shown only after server responses.

## Changes

- A memoized FocusElapsed component owns the stopwatch. It reads wall-clock time rather than counting intervals and updates its local state on actual second changes, including after tab visibility restoration. The global header updates every 30 seconds, independent of Focus.
- Start, Pause, and Resume display optimistic local states immediately while waiting for transactional server confirmation. In-flight Focus requests are serialized. Failures restore the last authoritative session state and surface an error. Snapshots that started before a Focus mutation cannot undo its session result.
- Clicking End immediately pauses locally and sends a server pause request. Review is available instantly but Save is disabled until the pause is acknowledged. Cancel leaves the timer paused; Resume is explicit. The dialog's maximum is frozen, preventing +2 seconds while deciding.
- Optional `displayed_seconds` on `POST /api/sessions/{id}/pause` allows reducing the unpaused amount to the click-time display; server clamps it to its calculated unpaused duration, so users cannot inflate study time via the new field.
- Optional `requested_at` on `POST /api/sessions/start` uses the click time when within five seconds of the server clock, avoiding an initial visual jump after brief network latency. Timestamps outside that window are clamped server-side. Legacy callers may omit the field.
- FastAPI endpoints that execute synchronous Firestore storage methods now use synchronous `def` routes (FastAPI dispatches them via its threadpool), so their blocking reads/writes do not stall the event loop. `snapshot` stays async and parallelized.
- The high-cost derived lists and Focus totals in Page use `useMemo`, avoiding repeated recomputation during UI-only interactions.

## Verification already performed in the packaging environment

- Backend `python -m pytest -q`: **87 passed, 1 skipped** (Firestore integration unavailable in this environment).
- Frontend `npm test`: **73 passed**.
- Credential scanner: passed.
- Python compileall: passed.
- TS/TSX syntax transpilation: passed for all changed frontend source files.
- Full `npm ci`, `npm run lint`, and `npm run build`: **NOT verified** because npm dependencies could not be installed in this environment (missing `@types/react`, `@types/node`, `@types/react-dom`). Execute them in local Windows environment and GitHub Actions before deployment.
- Real Firebase transaction latency and multi-tab behavior: **NOT verified**, must be tested on Preview.

## Preview manual acceptance checklist

1. On Home, start Quick Focus: the timer appears instantly; no navigation to the Focus page is needed. Wait for server ack and confirm the time does not jump backward under normal latency.
2. Pause at a known second (e.g. `00:00:09`): the displayed time stops immediately and remains frozen. Resume and verify paused wall time is excluded.
3. Click End at nine seconds, then wait 5+ seconds in review: the timer does not advance; Save persists nine seconds (or the smaller amount entered).
4. Cancel End review: session remains paused until Resume. This behavior is intentional.
5. Simulate a failed pause (e.g., use DevTools Network offline): error appears; optimistic state rolls back to the last confirmed server session. Reconnect and refresh.
6. Open two tabs and attempt simultaneous Start; only one can succeed (B1 guard). Verify the loser gets a conflict message and refreshes cleanly.
7. Switch tabs/lock screen for 30+ seconds then reopen: running stopwatch catches up to actual wall time, not number of timer ticks.
8. Navigate Home ↔ Study ↔ Tasks ↔ Calendar ↔ Focus while stopwatch runs; dashboard layout remains stable and all actions work.
9. Check server response headers and Vercel logs for errors/latency; check that Preview still points only to Preview Firebase.

## Next Phase C work (not in this ZIP)

- Profile Firestore snapshot with real populated Preview data and avoid unbounded historic session reads without losing all-time stats (introduce aggregated counters + paginated history only after designing correctness/repair paths).
- Profile and batch Drive index writes where supported, avoid unnecessary Firestore full scans.
- Finish CSS/dead-code cleanup and measure interaction performance using browser profiler; do not change design during optimization.
