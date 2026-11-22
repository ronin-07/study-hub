> **Historical document:** This file describes the early v0.3 architecture. For current v0.5 features, deployments and release gates, see [README](../README.md) and [Phase D checklist](phase-d-release-checklist.md).

# Study Hub: architecture and design decisions

## Modules

- `web/` — Next.js 16 App Router, TypeScript, responsive interface. No OAuth tokens are saved in the browser. The browser only receives a temporary object URL for previewed PDFs.
- `backend/` — FastAPI, Google OAuth code exchange, protected Drive file listings and PDF retrieval, data operations and focus-session transitions.
- `SQLiteStore` — persistent local development mode with per-user document namespaces.
- `FirestoreStore` — optional server-side Firestore storage behind Firebase Admin SDK, with Firebase ID-token verification and a single-user allowlist. No browser Firestore SDK is required.

## Schema

| Kind | Record | Notes |
|---|---|---|
| `courses` | course ID, code, title, semester, week count | Custom teaching-week counts |
| `weeks` | course ID, week number, topic, objectives | Optional week metadata; no forced 13-week assumption |
| `items` | study activity **or** personal task | **One record** with `is_task`. An assignment sets `is_task=true` automatically. The Course and Tasks screens update the same record. |
| `resources` | course, week, material kind, source, URL or Drive file ID, last manually chosen PDF page | Original source remains DTU Learn / Goodnotes/Drive; do not duplicate PDFs in Firebase |
| `drive-settings` | selected Google Drive backup folder and most recent on-demand scan timestamp | Per-user selection; no background worker |
| `drive-index` | PDF IDs, filenames, subfolder paths, modification dates and sizes | Metadata only, bounded recursive scan; no copied PDF contents |
| `sessions` | start time, pause periods, status, confirmed focus time, optional course/task | Server time used for pause/resume/finish; optional manual correction on finish |
| `secrets` | encrypted Drive OAuth tokens, keyed per Firebase UID | Never returned from public endpoints |

## Resource flow

1. User enables Goodnotes automatic PDF backups to Google Drive (already configured in their setup).
2. Study Hub uses authorization-code OAuth with restricted `drive.readonly` scope. Broad read-only permission is required for automatic discovery of pre-existing backup folders. `drive.file` is narrower but does **not** generally discover arbitrary existing files without a user selection flow.
3. User browses their backed-up Drive folders through the protected API, associates a PDF with a course/week and material type.
4. Study Hub stores the file ID in the resource index. Original and annotated lecture versions remain distinct source references attached to the same teaching week.
5. A PDF is requested from FastAPI using a Firebase bearer token (or loopback-only local mode). FastAPI verifies the user's permission, downloads the PDF, and returns it with no-store headers. The frontend embeds the returned Blob URL in its full-page viewer.
6. In v0.3, the user explicitly selects the Goodnotes backup folder, runs a bounded recursive metadata scan, reviews conservative filename/path-derived suggestions, and confirms any course/week links. Re-scanning refreshes indexed metadata and preserves existing linked resources. No background polling is running.
7. The viewer is read-only; edits stay in Goodnotes. PDFs are fetched on demand; the user can manually navigate pages and remember a selected page on linked resources. Scrolling inside the browser-native PDF viewer is not tracked. Updated backups with the same Drive file ID remain linked; a new file ID requires relinking.

## Focus-session rules

- Start, pause, resume, finish are server-side transitions. Only one running/paused session per user.
- Pauses do not contribute to `focus_seconds`.
- Closing browser does not delete a session. On returning, the UI shows the existing active/paused session.
- A long abandoned running session can overcount time. The completion dialog **requires explicit review** and permits a corrected focus duration up to the wall-clock elapsed duration.
- Stopwatch and 25/50/90 minute targets are available; session duration targets are indicative, and no browser alarm/pomodoro break scheduler is implemented yet.
- A finished session never automatically completes its study item.

## Security boundaries

- Local mode (`STUDY_HUB_AUTH_MODE=local`) trusts only loopback clients. Run with `--host 127.0.0.1`, never on a public IP, LAN or internet. Do not use local mode for a public Vercel deployment.
- Firebase mode verifies the Firebase ID token on every protected API request, checks the configured owner UID/email, then accesses only that user's Firestore namespace. No anonymous guest access.
- Google OAuth refresh tokens are encrypted at rest using a persistent server key, and must not be committed to Git.
- Drive API paths are fixed to Google's service; user-submitted IDs are checked. Retrieved previews are PDF only and capped at 50 MB.
- OAuth refresh tokens will be lost if an ephemeral SQLite filesystem is used. Set `STORAGE_BACKEND=firestore` for a persistent cloud deployment, or use a durable local disk.
- DTU Learn API integration is not implemented or assumed. DTU links are manually added.
- Use a dedicated Firebase project to avoid touching RepLap's Firestore and auth config. The `firestore.rules` example denies browser clients by design; the backend Admin SDK bypasses these rules.

## Known limitations and next features

- UI has a list-based Tasks view with Today/Upcoming/Completed, not a fully graphical calendar yet.
- No automated DTU Learn scraping or API authorization.
- No OCR, AI notes generation, background Goodnotes syncing, PDF text extraction, or file-update notifications. On-demand recursive metadata scanning exists in v0.3.
- File previews use the browser's native PDF viewer in an iframe. Manually selected last-page bookmarks exist; automatic scroll detection, annotation and split-screen focus panel do not.
- Course week editing, resource metadata editing, recurring tasks, due reminders and deletion of entire courses are not yet implemented.
- No automatic change stream or offline sync. The UI refreshes snapshot after mutations and on page load.
- OAuth `drive.readonly` is a restricted scope. For a personal test user, Google Cloud's external Testing publishing mode may expire refresh tokens after seven days. Reconnect Drive when needed; review Google's latest OAuth requirements before deploying.
- There are no mobile push notifications or reliable browser background alarms in v0.3.
