# Testing and release gates

[Home](../README.md) · [Deployment](deploy-vercel-firebase.md) · [Performance](performance.md)

## Automated coverage and limitations

Backend pytest exercises API behavior, isolated SQLite integration, validation, auth/configuration and simulated Firestore transactions. The SDK-dependent test can skip without Firebase Admin installed. Frontend Node tests cover logic and source-level regression contracts, not browser E2E. `npm run lint` is `tsc --noEmit`. GitHub Actions has backend, web and secret jobs; it runs on pushes, pull requests to main, scheduled and manual runs. CI uses Python 3.12 and Node 24 LTS, pip/npm download caches, pinned action references and read-only contents permission. Full browser interaction, published Firestore rules and live OAuth still require external verification.

## Local checks (PowerShell)

Run from a clean checkout with a test-only environment. Confirm Node 24.x and that the backend virtual environment uses Python 3.12 before running checks. Record actual runtime versions; a passing suite on a different runtime is not target-runtime verification. Do not inherit production variables or point to production. The backend virtual environment is described in the [README](../README.md).

```powershell
node --version
npm.cmd --version
Push-Location backend
.\.venv\Scripts\python.exe --version
$env:STUDY_HUB_AUTH_MODE = 'local'
$env:STORAGE_BACKEND = 'sqlite'
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m compileall -q app
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m pip install pip-audit
.\.venv\Scripts\python.exe -m pip_audit
Pop-Location
Push-Location web
npm.cmd ci --no-audit --no-fund
npm.cmd test
npm.cmd run lint
$env:NEXT_PUBLIC_STUDY_HUB_AUTH_MODE = 'local'
$env:NEXT_PUBLIC_API_URL = '/'
npm.cmd run build
npm.cmd audit --audit-level=high
Pop-Location
git diff --check
python scripts/check_credentials.py
```

Stage intended files before the credential check: it scans Git index blobs, not unstaged changes. With a verified Gitleaks installation, run `gitleaks git --log-opts="--all --full-history -m" --redact=100 .`; also scan an exported tracked snapshot with `gitleaks dir --redact=100 <snapshot-directory>`, as CI does. Never import old compromised refs. Record all findings, not only high severity; CI npm gate is high/critical. Do not run forced audit fixes blindly. No credentials or private diagnostic output in PRs.

## Preview acceptance

Use isolated Preview Firebase data and disposable fixtures. Check all three CI jobs and that the Preview deployment corresponds to the exact commit. A green build is necessary but not enough.

| Area | Checks |
| --- | --- |
| Security | `/health`, owner sign-in, invalid/missing token, valid non-owner denied; confirm actual project IDs differ, published client rules deny access, Admin IAM limited, no secret logs. |
| Workspace | Create/edit semester, course, weeks, duplicate code/name validation, shrink week count rejects out-of-range data, archive/restore and refresh; safe archived deletion blocks Focus history, wrong/stale confirmation, cross-course references; use disposable data. |
| Generation | Six defaults, selected weeks/custom types, 78-item generation for 13 weeks, duplicate retry, concurrent generation, existing edited activities remain, assignments separate from exercises. |
| Tasks and calendar | Shared completion, planned/due constraint, recurring successor exactly once even from two tabs, drag/reschedule planned date without altering deadline, hide linked activity without deletion, rollback on failed save, completed-today denominator stable and undo works across views. |
| Focus | Countdown 25/50/90/custom and stopwatch, target reached without auto-ending, pause at ~21 seconds without jumps, resume, review/confirm or cancel and stay paused, reload recovery, two simultaneous starts yield one active, zero-length sessions excluded, accurate summary and attribution. |
| Exam Prep | Exam dates update Home/Calendar, year/date sorting, fixed layout under search/filter, one new solution per paper (preserve legacy multiples), pair/unpair and exclude already paired papers, attempts (0% and ungraded), practice task reused, custom timer, distinct coursework/revision progress. |
| Resources | Link/unlink existing files, safe removal clears links but preserves original file and other activities, attempt blockers, stale confirmation, bookmarks survive metadata edit, canceled removal preserves state. |
| Drive (only if approved) | Connect, scan twice unchanged, no redundant index writes, review before link, disabled Preview shows expected state; access-token refresh and reconnect. |
| PDF | Cold/reopen under 50 MiB, original synthetic 500+ page PDF, >4.5 MB streaming, unchanged checksum gives 304, changed file downloads again, no stale preview on denial, cancellation/retry, 20-second slow notice and 120-second timeout, overlapping opens, saved page, chapter hyperlinks where viewer supports them. |
| UI and accessibility | Desktop/laptop and narrow/mobile Safari, both themes, stable search height, keyboard tab/Escape, dialog focus, reduced motion, tooltip clipping, save/loading/error states, no abrupt jumps or hydration errors. |
| Network and performance | Slow/offline request rollback, successful write followed by failed refresh, manual refresh, visibility return below/above 30 minutes, no unnecessary snapshots, `Server-Timing`, no private data in logs. |

Test real Firebase transactions separately from fake adapter tests. Never enable Drive on Preview with Production credentials. Verify real response headers (frame, MIME, referrer and permissions) and check browser console/API runtime logs without exposing tokens.

## Production smoke and rollback

After approval and merge, verify the deployed commit, owner sign-in, existing Home/Study/Tasks/Calendar/Exam Prep data, Focus history, Drive connection and read-only PDF open. Do not delete real records or create unnecessary test clutter. Check health, error logs and basic responsiveness. Confirm no unexpected database, secret, rules or billing changes. If a release fails, follow the [deployment rollback procedure](deploy-vercel-firebase.md#release-and-rollback).

## Historical evidence

The source handoff reported 177 backend and 248 frontend passing tests, and a passing production build. Those counts are historical, not a live CI badge; previous archive-only runs sometimes skipped SDK tests or failed env-example checks because Git metadata was absent. Record exact commit, runtime versions, test totals, skipped/failed tests, build and security audit outputs on each release. Never represent a static/source assertion test as browser coverage. Historical benchmark validation is in [performance](performance.md).
