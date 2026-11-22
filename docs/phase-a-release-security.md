# Study Hub v0.5 — Phase A release gate

## Emergency key rotation (must be performed manually)

The **old** source ZIP contained a complete Firebase Admin private key in `backend/.env.example`. This commit replaces the example with placeholders and adds a CI credential scan. **That does not revoke the key** or remove its copies from Git history, PR diffs, downloaded ZIPs, caches, or Vercel settings.

1. In Google Cloud Console, switch to the **specific project referenced by the exposed credential**. Under **IAM & Admin → Service Accounts**, locate the affected service account and revoke/delete the matching **key**. Ensure this action is applied to the correct project and key.
2. Verify the old key is disabled or deleted. Review the service account's IAM permissions and recent audit logs for unexpected activity. Consider requesting security support if any unauthorized use is suspected.
3. For each environment that still needs this service account, create a **fresh** key/credential, using least-privilege IAM. Do not reuse one key between Preview and Production. Store the full JSON only in Vercel's protected `FIREBASE_SERVICE_ACCOUNT_JSON` environment value for its respective environment.
4. Rotate dependent secrets if their values were exposed. Redeploy Preview and Production separately, after verifying each is bound to its intended Firebase project.
5. Check the repository and its Git history for the old key. If the key was committed, use an approved history-cleaning process and coordinate force-pushes carefully; rewriting history is not a substitute for rotation. Remove downloaded old source ZIPs containing the key.
6. Run `python scripts/check_credentials.py` after staging file changes and before pushing; GitHub CI repeats this check. The scanner is defense-in-depth and does not catch every type of secret.

**Never include service-account key text in issues, GitHub commit messages, screenshots, support requests, or chat.**

## Required environment variables (both Vercel Preview and Production)

- `VERCEL_ENV` supplied by Vercel (`preview` or `production`).
- `STUDY_HUB_AUTH_MODE=firebase`, `STORAGE_BACKEND=firestore`.
- `STUDY_HUB_ALLOWED_UID` and/or `STUDY_HUB_ALLOWED_EMAIL`.
- `STUDY_HUB_PREVIEW_FIREBASE_PROJECT_ID`: exact Preview Firebase project ID.
- `STUDY_HUB_PRODUCTION_FIREBASE_PROJECT_ID`: exact Production Firebase project ID. **Must differ from Preview.**
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: exact Firebase Web App project ID for the current environment.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: private Admin SDK credential whose `project_id` equals the current environment's expected project ID.

The backend now fails closed if the service account, web project, and expected environment differ. The frontend build captures `NEXT_PUBLIC_*` at build time, so change and redeploy each Vercel environment independently.

## Data contract change: reset Preview before exercising new version

- New courses **must** reference a registered `semester_id`. Create a semester before creating courses.
- Server derives the course's display `semester` name from that record; a client-supplied name cannot detach a course from its registered semester.
- A course code is unique within a semester (case-insensitive, whitespace-normalized). The same course code in a different semester is permitted.
- POST creates are **create-only** for courses, semesters, weeks, items, and resources, returning HTTP 409 for an existing document ID.
- Since Preview is expendable, reset old pseudo-semesters / orphaned course records. Do not re-import old records unmodified.

## Remaining release blockers after Phase A

**Do not merge to `main` yet**: Phase B must resolve Firestore transaction races (Focus singleton, course uniqueness under concurrent writes, task recurrence and semester rename fan-out); Phase C addresses performance; Phase D validates full Next.js build, browser interaction tests, actual Firestore rules and Preview/Production deployment. Phase A tests do **not** prove these later gates have passed.
