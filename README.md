> **v0.4.1 development update (feature branch; not merged):** The Academic Planner now uses semester-first navigation, one semester field in course editing, archive/restore instead of permanent deletion, shared Course Library for textbooks/whole-course Goodnotes notebooks, week-specific lecture PDFs, and reading references into a shared source. **Do not deploy to Production until Preview checks pass.** See [v0.4.1 implementation and test plan](docs/v0.4.1-implementation.md).

> **v0.4 development release:** Course/semester editing, split PDF reading workspace, linked lecture materials, preview isolation and CI. See [`docs/v0.4-implementation.md`](docs/v0.4-implementation.md) for source changes, test plan and deployment conditions.

# Study Hub — Private personal study workspace (v0.3 Drive library)

> **Cloud deployment update (v0.3.1):** The project can now be deployed as **one Vercel Services project** with Next.js + FastAPI, a dedicated Firebase Auth/Firestore backend, server-only Firebase credentials, and streamed Goodnotes PDFs. See **[Vercel & Firebase deployment guide](docs/deploy-vercel-firebase.md)** for exact dashboard and environment-variable steps. Cloud deployment has **not** been performed or tested against your accounts yet.


A **standalone** application for DTU study planning, linked personal and course tasks, focus-time logging, Goodnotes Google Drive PDF backups and an in-app PDF viewer. **RepLap is not modified.**

## What is implemented

- Responsive Next.js web interface: Today, Courses/Weekly Planner, Tasks, Focus, Resource Library. v0.2 adds a lavender editorial dashboard, mobile-friendly navigation, and a persistent light/dark theme switch.
- Custom courses and week counts, week topic setup, study checklists, assignments, planned work dates and due dates.
- **Shared item model:** course activities selected as tasks appear automatically in Tasks, with a single completion state. Assignments are always tasks.
- Focus stopwatch and 25/50/90-minute target presets, pause/resume, persistence across page reloads, session review and course/task attribution.
- Google Drive OAuth backend for private read-only Drive access (optional), folder/PDF browsing, selected-backup indexing, explainable matching suggestions, per-week PDF linking and protected PDF viewer within the app.
- FastAPI with SQLite local persistence by default, Firebase Admin Auth + Firestore option for private cloud hosting, tests for main API workflows.

**v0.3 added:** one explicitly selected Goodnotes backup folder; on-demand recursive PDF metadata scan (up to 500 PDFs/200 folders); conservative, explainable course/week suggestions; confirmation before linking; duplicate-link protection; updated file timestamps; PDF viewer page controls and a per-resource manually selected last-page bookmark. Drive API/OAuth remain untested against a real Google account.

**Not yet implemented:** authorized DTU Learn sync, automatic background Goodnotes syncing, OCR, textbook upload, advanced calendar, PDF annotation, production deployment. The app will not silently create course associations.


## v0.2 design and Grammarly warning

The interface has an updated visual theme, richer Today dashboard, brighter focus entry points, dark-mode toggle, and responsive polish. All API routes and existing database records are unchanged. For a quick update of an existing v0.1 copy, replace only `web/app/page.tsx`, `web/app/layout.tsx`, and `web/app/globals.css`; restart Next.js with `npm run dev`.

If Next.js shows a hydration warning with `data-new-gr-c-s-check-loaded` or `data-gr-ext-installed`, those attributes come from the Grammarly browser extension changing the HTML before React hydrates. Disable Grammarly on `127.0.0.1` / `localhost` or use a browser profile without extensions, then refresh. The root layout also uses `suppressHydrationWarning` on the document-level elements to tolerate extension-inserted attributes. This is intentionally limited to the root `html` and `body` tags and does not fix unrelated hydration problems.

The font stack optionally downloads DM Sans / Manrope from Google Fonts; system-font fallbacks are used when offline. No accounts, API credentials, or Google Drive settings need to be changed for the visual update.

## Quick start — local private mode (no accounts or keys required)

Requirements: Node.js 20.9+ (recommended 22), npm and Python 3.11+.

**Terminal 1 — backend:**

```bash
cd backend
python -m venv .venv
# macOS/Linux: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env                  # PowerShell: Copy-Item .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --env-file .env
```

**Terminal 2 — frontend:**

```bash
cd web
npm install
cp .env.local.example .env.local      # PowerShell: Copy-Item .env.local.example .env.local
npm run dev
```

Open **http://127.0.0.1:3000**. Data will be stored locally in `backend/data/studyhub.sqlite3`. Create your first course and teaching week; there is no fabricated default academic data.

**Security:** Local mode is for **your own computer only**. Do not bind the backend to `0.0.0.0`, open it through your router, or deploy it without Firebase authentication. It is not a shared service in this mode.

## Connect your existing Goodnotes backup (optional)

This integration uses Google's **Drive API**, not a Goodnotes API. Because you already have Goodnotes Automatic Backup → Google Drive → PDF enabled, no changes are necessary in Goodnotes.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a new project for Study Hub.
2. Enable **Google Drive API**.
3. Configure **Google Auth Platform → Audience**. For a private External Testing app, add your own Google account as a **test user**.
4. Configure **Data Access** to permit Drive read-only access. The scope is `https://www.googleapis.com/auth/drive.readonly`. It is broader than `drive.file` because Study Hub needs to browse PDFs Goodnotes already placed in Drive. Google may show an unverified-app warning in testing; never use credentials you don't trust.
5. Create OAuth Client ID **Web application** with authorized redirect URI `http://127.0.0.1:8000/api/drive/callback`.
6. Add the client ID and secret to `backend/.env`; ensure `WEB_URL=http://127.0.0.1:3000`.
7. Generate secrets **locally** and put them in `backend/.env`:

   ```bash
   python -c "import secrets;print(secrets.token_urlsafe(48))"  # APP_SIGNING_SECRET
   python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"  # OAUTH_ENCRYPTION_KEY
   ```

8. Restart FastAPI, go to **Library → Connect my Drive**, complete consent, and browse into the existing **Goodnotes backup folder**.
9. Click **Use this folder** to save it as your source, then **Scan for PDFs**. It indexes names, paths and modification times on demand — *not* file contents. Scanning all nested subfolders is bounded to 500 PDFs and 200 folders.
10. Study Hub suggests course/week/kind when it finds clear filename/folder clues (such as `02516/Week 10/...`). Verify the suggestions and choose **Confirm match**; for ambiguous files use the manual course/week selectors and **Link manually**. No PDF is linked without a click.
11. Open the linked PDF from the Course Planner. It remains in Drive; the read-only in-app browser viewer loads a temporary PDF copy and shows manual page controls. Use the page control to save a last-page bookmark. Scrolling the native PDF viewer doesn't update that bookmark automatically.
12. After annotating in Goodnotes, let its backup finish and click **Scan for PDFs** again to refresh the metadata index. This does not run on a schedule.

**Note:** Google OAuth apps in External **Testing** mode can have refresh tokens that expire in **7 days** when using Drive scopes. You may need to reconnect periodically. This is a Google OAuth policy, not a Study Hub timer bug. See [Google OAuth docs](https://developers.google.com/identity/protocols/oauth2).

## Private Firebase + Firestore mode (optional, later)

A separate Firebase project is recommended for isolation from RepLap.

1. Create a dedicated Firebase project; enable **Authentication → Google** and **Firestore**. Add the frontend origin as an authorized domain in Firebase Authentication.
2. Register a Firebase Web App and populate `web/.env.local` with the four `NEXT_PUBLIC_FIREBASE_...` settings. Change `NEXT_PUBLIC_STUDY_HUB_AUTH_MODE=firebase`.
3. On the backend, add `firebase-admin` credentials via **Application Default Credentials** (or `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON file kept outside Git). Set `STUDY_HUB_AUTH_MODE=firebase`, `STORAGE_BACKEND=firestore`, and `STUDY_HUB_ALLOWED_EMAIL=your-google-address@example.com` (or `STUDY_HUB_ALLOWED_UID`).
4. Use `docs/firestore.rules` **only in this dedicated project** if the browser never accesses Firestore directly. Firestore operations happen exclusively through the validated FastAPI server.
5. Serve FastAPI with persistent secrets and use HTTPS for deployed OAuth redirect URIs; keep its `WEB_URL`, `CORS_ORIGINS` and Google console redirect URI aligned.

**Do not** use the sample Firestore rules on RepLap's existing Firebase project.

## Git workflow

The full v0.3 repository download includes its local `.git` directory, with a clean v0.2 baseline on `main` and v0.3 on `feature/v0.3-drive-library`. There is **no GitHub remote** and your personal identity is not embedded in its commits (they use `Study Hub Bootstrap <bootstrap@studyhub.invalid>` as a neutral local author).

```powershell
cd studyhub-starter
git status
git branch -a
git log --oneline --all --decorate
```

If you already extracted v0.2 and created your own data in `backend/data/`, keep that folder! You can extract the **changed-files-only update ZIP** over the existing source. The complete repository ZIP is suitable for a new folder or fresh copy, not for overwriting a working data directory without first backing it up.

If you later want GitHub, create a private repository in your own account and add it as a remote; do **not** upload `.env`, databases or OAuth credentials.

## Tests / repository contents

```bash
cd backend
pytest -q
```

```
backend/app/          FastAPI API, storage adapters, auth and Google Drive
backend/tests/        API smoke and workflow tests
backend/.env.example  Backend config template (no real secrets)
web/app/              Next.js pages and responsive styles
web/lib/              API, Firebase sign-in and types
web/.env.local.example Frontend config template
docs/architecture.md  Schema, integration behavior, security and limitations
docs/firestore.rules  Backend-only access example for a NEW Firebase project
```

## Important deployment limitation

The frontend is designed for Next.js and the backend is a separately started FastAPI service. This ZIP does not configure a Vercel deployment, cron worker or file storage. A serverless deployment requires proper environment variables and token persistence (Firestore encrypted token records work for that); do not assume local SQLite persists across serverless requests.

### v0.5 Tasks & Calendar development

The Tasks screen includes a month planner, separate planned and due dates, course-linked tasks and after-completion recurring tasks. See [`docs/v0.5-implementation.md`](docs/v0.5-implementation.md) for Preview testing and limitations. Keep v0.5 iterations on `feature/v0.5-tasks-calendar` until approved for release.
