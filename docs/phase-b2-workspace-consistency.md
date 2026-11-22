# Study Hub v0.5 — Phase B2: Workspace structural transactions

**Apply after Phase B1 (including its CI `.env.example` fix)** to `feature/v0.5-tasks-calendar`. This incremental ZIP contains only the files changed by B2, **not** Phase A or B1. Do not apply it to an older source snapshot, and do not merge to `main` without explicit approval.

## What changes

- All semester, course and teaching-week creates and edits validate against a single transactional snapshot, so concurrent requests cannot create duplicate normalized semester names, duplicate course codes within a semester, or duplicate teaching-week numbers within a course.
- Course moves and edits validate a registered semester and use the latest course state. Changes to different fields from two tabs no longer clobber one another.
- Semester renaming updates its `semester` label cache in **all linked course documents atomically** with the semester document; failures roll back every change. A semester cannot be removed while a course is linked. Archived courses still count as linked, as before.
- Course shortening rejects any items, resources or weeks that would fall outside the new week count. Week/resource/item creation checks the current course inside the same transaction, rather than trusting a prior standalone read.
- Resource create/edit and item/resource deletion use the same transaction path for link consistency, duplicate Drive links, and archived-course guardrails. Reading bookmarks now patch the latest resource atomically rather than replacing a possibly stale document.
- Course archival checks the active Focus guard and the current session in its transaction; Focus session start rechecks the linked course inside its own transaction, so simultaneous archive/start requests serialize safely. Legacy guardless sessions are also checked until Preview is reset.
- No frontend layout changes and no API payload changes. Existing v0.5 course/semester/week, note, resource, task and Focus UI stays in place.

## Firestore design

Existing user-owned collections remain at `users/{uid}/studyhub_{semesters,courses,weeks,items,resources,sessions}`. A new **server-owned** transaction serialization document is created on the first structural write:

`users/{uid}/studyhub_workspace_guard/state`

Data: `{ "id": "state", "revision": <non-negative integer> }`. All workspace structural transactions read and increment this document. Concurrent transactions that read the same revision conflict, causing Firestore's transactional decorator to retry against a fresh snapshot. This avoids unsafe check-then-write uniqueness scans without requiring new client Firestore permissions. Every read is completed before the first actual transactional write (writes are staged in memory by `WorkspaceView`).

This is appropriate for **one person's low-frequency coursework writes**, but all structural writes share one contention point. High-throughput multi-user workload performance is not implied. Firestore transactions have SDK retry limits, document read/write costs, and request limits; Phase C can replace scans with indexed sentinel keys if real usage warrants it. Semester renames involving more than 498 linked courses deliberately return HTTP 409 rather than attempt a transaction exceeding the 500-write budget.

**Rules**: `docs/firestore.rules` remains deny-all; client requests cannot write the guard. Admin SDK requests bypass Security Rules and are controlled by IAM and backend authentication. Do not change rules to public write-access to make this function work.

## Preview migration

B2 requires **no new document fields** in existing user records, but existing duplicate semester names/course codes/week numbers can violate its uniqueness assumptions. Since Preview data is expendable, preferably reset `studyhub_semesters`, `studyhub_courses`, `studyhub_weeks`, `studyhub_items`, `studyhub_resources`, `studyhub_sessions`, `studyhub_focus_guard`, and `studyhub_workspace_guard` **only under your Preview UID in your Preview Firebase project**, if you have not already cleared older test records. Back up anything you want to retain first. **Do not delete Drive tokens, OAuth secrets or Drive indexing** unless intentionally disconnecting Google Drive. Never reset Production while testing.

If Preview was reset after B1 and has only unique records, you may keep it. Old sessions without the B1 guard remain incompatible with Focus resume/finish; clear them as described in B1.

## Verification

Run locally:

```powershell
cd backend
python -m pytest -q
cd ../web
npm ci
npm test
npm run lint
npm run build
```

Then deploy to the existing v0.5 Preview branch and verify using **two tabs** signed in as the same user:

1. Create two semesters with the same name (including case/whitespace changes) at once: exactly one saves, the other receives 409.
2. Create two courses with the same code in the same semester at once: exactly one saves. Reuse the code in a *different* semester: allowed.
3. Move a course into a semester where its code already exists: blocked; changing the code first enables the move.
4. Create the same teaching week twice: second request blocked. Shrink a course with later-week data: blocked.
5. Rename a semester and refresh: every linked course displays the new name; no partial renames.
6. Edit different fields of one course/week/resource from two tabs: both changes persist after refresh (same-field changes still follow last-committed-writer wins; see below).
7. Start Focus while archiving its course: either Focus starts and archival fails, or archival succeeds and Focus start fails; never both.
8. Open a PDF and save a page while editing its metadata: both updates persist; linked resource deletions are blocked.
9. Recheck global sidebar, course/week navigation, PDF/Goodnotes resources, calendar, recurring tasks and Focus controls.
10. Confirm correct Preview Firebase project and no Production data changes. Confirm GitHub Actions and Vercel Preview both show success.

## Verification actually completed while preparing the ZIP

- **81 backend tests passed, 1 Firestore SDK test skipped** (SDK unavailable in this execution environment).
- **69 frontend source/unit tests passed** (`npm test`).
- Python compile passed; credential source scan passed.
- The added Firestore transaction contract simulator checks staging, rollback and read-before-write. This **does not** substitute for Firestore Emulator or live Preview concurrent transactions.
- Full Next.js typecheck and build remain **unverified** here because the npm dependencies are not installed.

## Known remaining limits / Phase C and release gates

- Two stale clients changing the **same field** will still use last-committed-writer wins. Explicit revision/If-Match handling plus frontend conflict UI would be needed for strict same-field rejection.
- A single per-user `workspace_guard` increases write contention for very high frequencies. Optimize if measured performance warrants it.
- Other independent Drive index/OAuth operations retain their existing storage pathways and should be audited separately for idempotency/races; they do not write these course/resource records.
- The app still loads entire Focus history in snapshots; scheduled Phase C performance optimization remains.
- Actual Firestore transaction retries, Vercel build success, authenticated Preview operation and Google Drive/Goodnotes integration **must** be verified before Production release.
