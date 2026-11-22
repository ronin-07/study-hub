# Study Hub v0.5 — Phase D release gate and UI copy cleanup

**Branch:** `feature/v0.5-tasks-calendar`  
**Source assessed:** latest local assembled Phase C2 tree provided in this conversation, with Phase D changes; **not** a verified GitHub HEAD or live Vercel deployment.

## Changes in this Phase D increment

- Removed repetitive explanatory paragraphs and marketing copy on Home, Tasks, Calendar, Study, Focus, and Resources. Section titles, field labels, empty states, error messages, and destructive-action warnings remain.
- Kept a short statement that timed Focus sessions do not automatically stop, and that a session persists after closing the browser tab.
- Preserved all six global navigation destinations and five course workspace tabs.
- Routed the mobile navigation buttons through the existing `navigate()` helper, matching desktop state handling for Tasks and Calendar.
- Removed unused `page.tsx`/`course-planner.tsx` variables and icons; removed styles for the deleted Goodnotes helper card and unused Home intro paragraphs.
- Added conservative Next.js response headers for clickjacking, MIME sniffing, referrer leakage and unnecessary permissions. **No untested restrictive CSP** was added: Firebase Google Sign-In, Drive OAuth and PDF embedding need deployed browser testing first.
- Replaced outdated root README with the current architecture, local instructions, and release gates.

## Verified locally on this baseline

- Backend regression tests and SQLite integration checks: see accompanying results.
- Frontend Node logic/source regression tests: see accompanying results.
- Python source compilation and TS/TSX syntax parsing: see accompanying results.
- CSS parser: no syntax errors after removing proven-unused selectors.
- Source-level Firestore rules check: deny-all is retained. **Not** proof of published Firebase rules.

## Required external checks (must complete before merge)

### Exact-commit CI gate

1. Confirm `git status` is clean and note `git rev-parse HEAD`.
2. On that exact commit, GitHub Actions must show a green **backend** job (credential scanner, pytest, compileall) and **web** job (`npm ci`, strict TypeScript, frontend tests, optimized `next build`).
3. Confirm Vercel Preview's **Ready** deployment resolves to the same commit hash, with no TypeScript/build errors.
4. Visit Preview with browser devtools open: no React hydration, CSP, Firebase, API, or console errors; check desktop light/dark themes and mobile width.

### Firebase security and data-isolation gate

1. Confirm the old service-account key has been **deleted** from Google Cloud; user reports this complete. Check no further exposed keys in Git history and Vercel env scopes.
2. Confirm Preview and Production use different actual Firebase projects, web project IDs, service accounts, and allowlisted users. Never point Preview at Production.
3. Verify the **published**, not just local, Firestore rules deny all direct client SDK reads/writes in both environments. Admin SDK requests are not governed by client rules; check its least-privilege IAM.
4. Check that an unauthenticated user and a valid but non-allowlisted Firebase user cannot access `/api/snapshot`, resources, or Focus routes.
5. Verify live Firestore transactions with two tabs / separate browser sessions: concurrent Focus starts yield one active session; recurring-task double-completion yields one successor; duplicate course/semester/week create is rejected; semester renaming and course moves preserve consistency; PDF reading position does not overwrite metadata edits.
6. Production is currently empty; there is no migration requirement. Reset **only Preview**, if necessary, to remove experimental records before final integration checks.

### Browser workflow gate

1. Sign in and refresh; verify all six navigation entries and active course/semester context. On narrow mobile, use calendar navigation and return to Tasks.
2. Create semester, course, week, activity; edit, archive, restore; test all five course tabs and persistent notes. Verify no duplicate course panel in the global sidebar.
3. Schedule course/personal tasks from Tasks and the calendar; complete in Home/Study/Tasks and check state everywhere. Confirm a task cannot be planned after its due date.
4. Test repeating tasks: complete once, verify exactly one next occurrence with correct planned/due dates.
5. Focus timed countdown modes 25/50/90 start at their target and reach zero visually, without auto-ending; Stopwatch counts upward. At ~21 s, Pause must freeze *without* 21→22→21 jumps; Resume continues smoothly. Header and page must agree. End review freezes the same value and saves correct total.
6. Close/reopen a tab while Focus is running; ensure the active state is restored. Test slow network, two-tab synchronization, and failed API actions with rollback.
7. Drive/Goodnotes (if enabled in an isolated test project): authorize, scan twice with no changes, verify zero redundant index writes on second scan; link a PDF, open, save reading position, edit resource metadata, refresh, and verify both persist. No unconfirmed automatic links.
8. Check HTTP response headers on real Vercel pages: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` and `Permissions-Policy`. Verify Firebase Sign-In and PDF reader still function.
9. Verify keyboard tab order, Escape/close behavior, modal focus and adequate contrast; source-level tests do not establish accessibility.

### Operational gate

- Record the Preview commit, CI run and deployment result; compare intended Firebase project ID without printing credentials.
- Verify a recovery workflow: reverting a deployment safely while preserving Git history; reserve merge to `main` for explicit approval.
- Capture API `Server-Timing` and Firestore read/write counts for Home snapshot, Focus Pause/Resume, and two successive Drive scans. This must be measured in the real environment; local simulator timings are not cloud benchmarks.

## Known release limitations / explicit deferrals

- Same-field edits from two devices use last-committed-write wins; they are not collaborative merges.
- The UI does not have automatic offline syncing or DTU Learn API access.
- Focus target durations are **goals**, not automatic stop conditions; the stopwatch can continue after the countdown reaches zero.
- `npm run lint` is a TypeScript typecheck, not an ESLint/React accessibility pass.
- No real-browser E2E framework or live Firestore emulator/integration runner was available in this local package environment. Local tests and source assertions are **not** approval to release.

**Decision:** Keep `main` unchanged until all exact-commit CI and Preview checks above are verified and the owner explicitly approves release.
