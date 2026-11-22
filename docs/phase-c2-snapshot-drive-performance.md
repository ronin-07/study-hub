# Study Hub v0.5 — Phase C2 (Firestore reads & Drive index write efficiency)

**Baseline:** Phase A + Phase B1 + Phase B2 + Phase C1/C1b/C1c, including the TS322 interval-type fix. Apply only to `feature/v0.5-tasks-calendar`; do not merge to `main` without approval.

## Implementation

### Compact Focus history snapshots

- The UI requests `/api/snapshot?compact=true&week_start=<client-local-Monday-unix-seconds>`.
- All-time Focus totals and completed-session count are kept in the private `users/{uid}/studyhub_focus_summary/state` document. The server updates it atomically with session finish or completed-session deletion; all-time stats are **not** approximated from a truncated history.
- The API returns the currently active session, finished sessions from the requested local week, and up to five most recent finished sessions. The `sessions` array deduplicates overlaps and contains no arbitrary cap on the current week.
- Old callers using `/api/snapshot` without `compact=true` still receive the complete list (backward compatibility).
- Existing accounts with sessions but no summary have an automatic **one-time transactional bootstrap** from the old history. This is a one-time full read, not a recurring scan. After that, each compact snapshot reads a summary document, the current week, up to five recent documents, and the active guard/session.
- The frontend updates the aggregate optimistically on successful completion, while protecting it against an older snapshot arriving after the Focus write. Focus display/ring and countdown timing are unchanged.

**Schema:** `users/{uid}/studyhub_focus_summary/state` with fields `id`, `total_seconds`, `completed_sessions`. Reads use single-field indexes on `ended_at` (descending order and range filter); these are enabled by standard Firestore auto-indexing unless the project has explicitly disabled the index.

**Caveats:** A user with extremely large existing history may exceed a Firestore transaction's limits during first-time bootstrapping. Production is currently empty; Preview test records may be reset if necessary. Compact responses include all sessions in the current week, which remains proportional to sessions recorded in that week. An external administrator editing Firestore session documents directly bypasses the summary maintenance contract.

### Google Drive index synchronization

- Index scan only writes changed/new metadata and deletes removed files; unchanged Goodnotes PDFs generate **zero index document writes** on a repeat scan.
- Firestore uses batches of at most 400 writes; SQLite performs the diff in one transaction.
- The Drive async endpoints move blocking index updates off the event loop using `asyncio.to_thread`.
- A just-scanned index is reused when returning suggestions, avoiding an immediate redundant index collection read.
- The scan response includes a diagnostic `changes: {added, updated, removed}` field. Existing clients need not read it.
- PDF contents, Drive OAuth, course associations, manual link review, and Goodnotes folder discovery behavior are unchanged.

**Caveat:** Firestore scans that require more than 400 updates commit in several batches. They are not a single atomic transaction. A partial network failure can leave a partially updated index; a repeated scan reconciles it. The original per-document approach also had partial-write exposure.

## Locally verified

- Backend: **97 passed, 1 skipped** (Firestore Admin SDK/emulator integration is not available locally).
- Frontend: **86 passed**.
- Python compilation and credential scanner passed.
- TSX/TypeScript syntax transpilation passed for modified UI and Focus components.
- Full `npm run lint` and `npm run build` could **not** complete in the execution environment because `@types/node`, `@types/react`, `@types/react-dom`, and the Next.js executable are missing. Syntax success is **not** TypeScript build success.
- Live Firestore Preview queries/transactions, actual user-perceived API latency and Firestore billing improvements remain unverified. Do not claim a measured speedup or production readiness from local tests.

## Local and Preview release gate

1. Apply only the files in the C2 ZIP on top of the latest C1c branch. Do not overlay older phase ZIPs.
2. In `backend`, run `python -m pytest -q`.
3. In `web`, run `npm ci`, `npm test`, `npm run lint`, `npm run build`. Resolve every TypeScript/build failure before pushing.
4. Check GitHub Actions; wait for Vercel Preview to show **Ready**. Confirm Preview remains bound to the Preview Firebase project.
5. Use a browser with existing completed sessions, including a previous week. Verify **All time** and **Completed sessions** remain unchanged across refreshes; verify **This week** matches current local-week completions.
6. Start, pause, resume, and finish a new Focus timer. Confirm all-time totals increase by the saved duration **once**, the ring and countdown remain smooth, and refresh preserves the values.
7. If the test account has many old sessions, verify the first compact request successfully bootstraps `studyhub_focus_summary/state`; check subsequent snapshots do not fetch every session.
8. On a test account, delete a finished session via the API (if permitted) and ensure totals decrease accurately. (The UI doesn't currently expose deletion.)
9. Scan the same Goodnotes folder twice. The first scan creates/updates records; the second should have `changes.added=changes.updated=changes.removed=0` unless Drive metadata has changed.
10. Change the source folder, scan again, and verify the index does not retain records from the previous folder. Also test Drive disconnect/reconnect, PDF opening, and manually linking resources.
11. Test switching tabs and a second browser session during Focus completion. Do not introduce a stale statistics rollback.
12. Check Firestore read/write counts in Google Cloud after at least two snapshots and two unchanged scans; compare with the previous Preview build using the same data before claiming a quantified improvement.

## Remaining before production

- Firestore Emulator or real **Preview** transaction and query integration tests (SDK-specific behavior and indexes).
- Full Next.js typecheck/build and manual browser acceptance.
- Separate visual CSS/dead-code consolidation only after profiling, so approved Study page and timer CSS are not inadvertently affected.
- Production merge requires explicit user approval.
