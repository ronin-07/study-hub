# Study Hub v0.5 — Phase B1: Atomic Focus + Task Recurrence

Apply this increment **on top of Phase A** on `feature/v0.5-tasks-calendar`. The ZIP does not include earlier Phase A files. Do not apply it to an older v0.5 checkout.

## Intent

- One authoritative active Focus slot per user, with the session created and the guard established by one atomic transaction.
- Pause/resume/finish/delete serialize against each other. Finishing or deleting an active session frees the guard in the same transaction. A second simultaneous start gets HTTP 409.
- Completed recurring tasks update the current item and create the next occurrence atomically. A stable next-occurrence ID prevents duplicates. Concurrent edits to different fields merge against the latest committed item snapshot rather than overwriting an earlier read.
- Manually confirmed Focus seconds cannot exceed actual unpaused seconds.

## Firestore layout

The new per-user, server-only guard is:

`users/{uid}/studyhub_focus_guard/active`

Its payload is `{ "id": "active", "session_id": "<FocusSession ID>" }`. The original Focus records remain in `users/{uid}/studyhub_sessions/{id}`. Ordinary GET `/api/snapshot` still reads only the original six collections, not the guard. No new Firestore index is required for document-ID lookups.

`docs/firestore.rules` remains deny-all. Only the authenticated FastAPI backend uses the Firebase Admin SDK. The Firestore adapter uses `google.cloud.firestore.transactional`; all transaction reads occur before writes.

## Preview migration and testing

**Because Preview data is expendable, clean its old Focus data once before testing this change.** Older sessions were created without the `studyhub_focus_guard/active` document. Clear *only* `users/{your-preview-uid}/studyhub_sessions` and `users/{your-preview-uid}/studyhub_focus_guard` in the **Preview Firebase project**. Check the project ID twice and leave Production untouched. Keep other collections unless you want a full Preview reset.

If an old active session remains without a guard, the new API intentionally rejects its pause/finish with HTTP 409 rather than quietly rewriting inconsistent state. A clean Preview start avoids this. In Production, the user confirmed there is no existing data.

After deploying, test on **two browser tabs/devices** signed in as the same user:

1. Start Focus from both tabs simultaneously. Exactly one should start; the other should show a conflict / need to refresh.
2. Pause from one tab and resume from the other; state should synchronize after refresh, with no lost paused duration.
3. Finish the session; a new session can immediately start. Delete a running session; another one should start.
4. Create a recurring task and complete it simultaneously on both tabs. The next occurrence must be created once; all completed timestamps and due-date offsets should remain consistent.
5. Finish a mostly-paused Focus session and verify its confirmed time cannot exceed unpaused time.
6. Verify archived courses, resource links, calendar behavior and navigation are unaffected.

## Local checks

```bash
cd backend
python -m pytest -q
cd ../web
npm ci
npm test
npm run lint
npm run build
```

In the implementation environment: **67 backend tests passed, 1 Firestore-SDK integration test skipped; 69 frontend tests passed.** This does **not** establish that an actual Firebase transaction works: run a real Preview or Firestore Emulator smoke test, and verify the Next.js build on your own machine / CI. The local environment did not have a full `node_modules` installation.

## GitHub Actions compatibility after untracking `.env` files

Phase B1 also updates `backend/tests/test_phase_a_release.py`. The Phase A security test used to unconditionally read `backend/.env.example`, causing a `FileNotFoundError` after the file was removed from Git tracking. The updated test:

- Checks every *present* local example for embedded private-key material.
- Accepts a *missing* example only when it is not tracked in Git, which is the expected GitHub Actions checkout after `git rm --cached`.
- Does **not** require adding any `.env` file back into Git. The separate `scripts/check_credentials.py` CI step continues scanning tracked source files for accidental credentials.

Recommended `.gitignore` patterns include `**/.env` and `**/.env.*` to cover local, preview, and example variants. Verify with `git ls-files | grep '\.env'` (PowerShell: `git ls-files | Select-String '\.env'`).

For validation, both the normal source tree and a simulated checkout with no example `.env` files passed the updated backend security checks.

## Known remaining work, not claimed as fixed by this increment

- Semester rename fanout and course/resource/week unique-key sentinels are not yet atomic.
- Multiple devices editing the *same* item field still use last-committed-write wins; a version/ETag conflict policy would be needed to reject all same-field collisions.
- The Drive scan index still performs many independent Firestore writes.
- Whole-snapshot session history and large collection scans still need the planned Phase C performance pass.

Do not merge to Production based solely on these tests. Complete the remaining integrity checks and the release checklist first.
