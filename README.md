# Study Hub v0.5

Private DTU study-management app with semesters, courses, weekly learning activities, tasks and calendar, focus sessions, and Goodnotes/Google Drive PDF resources. This is the established **Next.js 16 + FastAPI + Firebase** project; it is not a starter app or a RepLap feature.

**Release state:** v0.5 is on `feature/v0.5-tasks-calendar` for testing. Do not merge to `main` until the [Phase D release gates](docs/phase-d-release-checklist.md) pass on the exact commit to be merged.

## Features

- **Home:** today's study courses, priorities, upcoming deadlines, seven-day agenda, focus statistics.
- **Study:** Semester → Course → Teaching Week navigation, five course tabs, weekly checklist, shared Course Library, weekly resources, notes, and archived courses.
- **Tasks and Calendar:** personal and course-linked tasks, dates and deadlines, recurrence, status synchronization, monthly calendar and drag-to-plan.
- **Focus:** 25/50/90-minute countdown modes and count-up Stopwatch; instant Pause/Resume, manual End/review, task attribution, aggregated study-time statistics.
- **Resources:** optional read-only Google Drive integration for existing Goodnotes PDF backups; manual scanning, review before linking, protected in-app viewer and reading positions.

### Technology and privacy

The browser signs in using Firebase Authentication and calls protected FastAPI routes. Server-side Firebase Admin SDK accesses Firestore with IAM; browser Firestore reads/writes are denied by [the rules template](docs/firestore.rules). Deploy Preview and Production against **different Firebase projects**. Never commit `.env` files, service-account JSON, Google OAuth tokens, or encryption keys. Local development uses SQLite and loopback-only auth mode.

## Development and validation

Requirements: Node.js 22 (minimum supported 20.9), Python 3.12 recommended, npm.

```powershell
# Run backend locally (PowerShell, from repository root)
cd backend
python -m pip install -r requirements.txt pytest uvicorn
$env:STUDY_HUB_AUTH_MODE = "local"
$env:STORAGE_BACKEND = "sqlite"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
# In a second terminal
cd web
npm ci
$env:NEXT_PUBLIC_STUDY_HUB_AUTH_MODE = "local"
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:8000"
npm run dev
```

Go to `http://127.0.0.1:3000`. All local data stays in the untracked SQLite database.

Before any Preview push or production merge:

```powershell
cd backend
python -m pytest -q
cd ..
python scripts/check_credentials.py
cd web
npm ci
npm test
npm run lint
npm run build
```

`npm run lint` currently runs the strict TypeScript check (`tsc --noEmit`); it is not ESLint. Source-assertion tests complement, but do **not** replace, browser interaction testing.

## Deployment

- A Git push to `feature/v0.5-tasks-calendar` triggers Vercel Preview when Git integration is enabled; do not push or merge automatically.
- Vercel's two services are configured in [`vercel.json`](vercel.json): Next.js under `web/`, FastAPI under `backend/`.
- Set `STORAGE_BACKEND=firestore`, `STUDY_HUB_AUTH_MODE=firebase`, `FIREBASE_SERVICE_ACCOUNT_JSON`, an allowlisted UID/email, and the matching Preview/Production Firebase project IDs. The API refuses hosted projects that do not match their Firebase web and Admin credentials.
- Set `NEXT_PUBLIC_STUDY_HUB_AUTH_MODE=firebase` and the appropriate Firebase web-app variables. Set `NEXT_PUBLIC_API_URL=/` for same-origin API routes.
- Deploy [deny-all Firestore rules](docs/firestore.rules) **only** to the dedicated Study Hub projects. These rules are not for RepLap.
- Google Drive OAuth is optional and may be intentionally disabled in Preview. Do not enable it by reusing Production secrets.

See [Phase D release checklist](docs/phase-d-release-checklist.md) for the required GitHub Actions, Vercel, Firestore, Focus, and Google Drive checks. Historic milestone notes in `docs/` remain for context and are not authoritative for current capabilities.
