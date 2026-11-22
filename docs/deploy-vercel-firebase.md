> **v0.5 Phase A update (22 Nov 2026):** Follow [phase-a-release-security.md](phase-a-release-security.md) before deploying. The older deployment steps below predate mandatory explicit Preview/Production project IDs and registered semester requirements; do not use them without the Phase A checks.

# Study Hub — deploy with Vercel Services and Firebase (v0.3.1)

This setup keeps **RepLap untouched**. You can deploy and use Study Hub without running npm or Python locally. The repository contains two services: `web/` (Next.js) and `backend/` (FastAPI). The root `vercel.json` routes `/api/*` to FastAPI and everything else to Next.js using one HTTPS domain.

**Do not deploy v0.3 unchanged.** Use the cloud-ready source update with the fail-closed serverless configuration.

## 1. Update your current Git repository

Extract the `studyhub-cloud-ready-files.zip` contents **into the existing Study Hub repository root**, preserving paths. It contains only source/config/doc files; no `.git/`, `.env`, local database, secrets, or `.patch` files. You have already initialized Git: **do not run `git init` again**.

```powershell
# Run inside your Study Hub repository root
git status
git add vercel.json backend web/lib/api.ts web/.env.local.example docs/deploy-vercel-firebase.md README.md
git commit -m "chore: prepare Study Hub for Vercel and Firebase"
```

Prefer creating a private GitHub repository, then pushing your existing branch. In GitHub, create an **empty private repository** (do not initialize with a README). Run:

```powershell
git remote add origin <YOUR_PRIVATE_GITHUB_REPO_URL>
git branch -M main
git push -u origin main
```

If you have a remote already, skip `remote add` and use `git push`. Do not include Git credentials in your code or commit secrets. Vercel can then deploy automatically from GitHub whenever you push. If you'd rather avoid GitHub, use `npx vercel --prod` from the repository root, but Git-based deploys are more convenient for testing and updates.

## 2. Create a dedicated Firebase project

1. In https://console.firebase.google.com, create **Study Hub** as a separate project from RepLap.
2. Build → Authentication → Get started → Sign-in method → **Google: Enable**. Set the support email.
3. Project settings → General → **Add Web App**. Copy `apiKey`, `authDomain`, `projectId`, `appId` from its Firebase configuration (these are intended to be browser-visible).
4. Build → Firestore Database → Create database → Standard edition; select a suitable European location and production mode. Region choice may be difficult to change later.
5. Firestore → Rules: set the exact contents of `docs/firestore.rules`, then publish. This *denies client-side reads and writes*: the verified Python server uses Firebase Admin SDK and can still access data. **Apply only to the new Study Hub Firebase project.**
6. Project settings → Service accounts → **Generate new private key**. Keep this JSON private, never commit or share it. Its whole JSON contents will be stored as `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel's protected environment variables.

## 3. Import your private repo in Vercel

1. Open https://vercel.com/new and import the private GitHub repository.
2. Keep the **Root Directory as the repository root**, not `web/`. The root `vercel.json` defines **Services** for `web/` and `backend/`.
3. Use the Services project/framework configuration if the Vercel UI asks. The configuration uses the current `services` key (not the older `experimentalServices`). This feature is still labeled Beta by Vercel.
4. Add these environment variables for **Production** before your first live deployment:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_STUDY_HUB_AUTH_MODE` | `firebase` |
| `NEXT_PUBLIC_API_URL` | `/` (same origin) |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web App `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Web App `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Web App `projectId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Web App `appId` |
| `STUDY_HUB_AUTH_MODE` | `firebase` |
| `STORAGE_BACKEND` | `firestore` |
| `STUDY_HUB_ALLOWED_EMAIL` | Your exact Google account email address |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Complete JSON from the **new Study Hub Firebase project's** service account file, on a single environment-variable value |

You can use `STUDY_HUB_ALLOWED_UID` instead of (or in addition to) `STUDY_HUB_ALLOWED_EMAIL` after identifying your Firebase Auth UID. The backend rejects any other user's requests even if they authenticate with Firebase.

**Important:** Service-account JSON and OAuth secrets must be server-side environment variables, *never* prefixed with `NEXT_PUBLIC_`.

5. Deploy. Vercel builds the Next.js site and FastAPI API; the build runs in Vercel, not on your laptop.
6. Record your **stable production hostname** (e.g., `study-hub-example.vercel.app`). Never use an ever-changing preview deployment URL as a Google OAuth callback.
7. Firebase Authentication → Settings → Authorized domains → add your exact production hostname, **without** `https://`. Redeploy if you changed browser environment values.
8. Verify `https://<YOUR_DOMAIN>/health` reports `storage: firestore` and `auth: firebase`; verify the sign-in screen loads. You should be able to sign in with your Google account and create a test course. If you see a configuration or 500 error, inspect Vercel's runtime logs for the API service and confirm service-account JSON and Firestore initialization.

The backend deliberately **refuses** to start using SQLite or `local` authentication in a Vercel environment.

## 4. Configure Google Drive OAuth (Goodnotes)

Firebase Authentication and Google Drive OAuth are **two separate integrations**. The Firebase sign-in Google provider does *not* grant the application access to your Goodnotes Drive PDFs.

1. In https://console.cloud.google.com use **a separate Google Cloud project** for the Google Drive OAuth integration if you want the new **Personal mode** for just your Google account. Choose Personal mode when creating the OAuth project; existing External projects cannot simply be converted to Personal mode.
2. Enable the **Google Drive API** for that Cloud project.
3. Create a **Web application** OAuth client. Under Authorized redirect URIs, enter exactly:

   `https://<YOUR_DOMAIN>/api/drive/callback`

4. Add these **server-only** Vercel Production environment variables:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | The Drive OAuth Web Client ID |
| `GOOGLE_CLIENT_SECRET` | The Drive OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `https://<YOUR_DOMAIN>/api/drive/callback` |
| `WEB_URL` | `https://<YOUR_DOMAIN>` |
| `APP_SIGNING_SECRET` | A strong random signing key (32+ random bytes encoded as a string) |
| `OAUTH_ENCRYPTION_KEY` | A **Fernet key**: URL-safe Base64 encoding of exactly 32 random bytes |
| `CORS_ORIGINS` | `https://<YOUR_DOMAIN>` (same-origin requests don't require CORS, but keep this explicit) |

For a one-time PowerShell **secret generator**, run the following twice; use **different outputs** for `APP_SIGNING_SECRET` and `OAUTH_ENCRYPTION_KEY`:

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($b)
[Convert]::ToBase64String($b).Replace('+','-').Replace('/','_')
```

Use a *stable* `OAUTH_ENCRYPTION_KEY`: changing it will make previously stored Drive tokens undecryptable, requiring a new authorization. On Vercel, keep it private. The encrypted tokens themselves are stored persistently in Firestore, not Vercel's temporary filesystem.

5. **Redeploy** after adding the new variables. In Study Hub, open **Library → Connect Google Drive**. Choose the existing Goodnotes backup folder, scan, review suggested course/week matches, and open a PDF inside the app.
6. Personal mode is restricted to the creator's Google account and avoids the 7-day Testing-mode refresh token expiration. Access tokens still expire and refresh automatically, and any refresh token can be revoked; Study Hub will request reconnection when necessary.

## 5. Production acceptance tests

- [ ] `GET /health` reports `firestore` and `firebase`.
- [ ] Google sign-in works on the **stable production domain**.
- [ ] Unauthorized Google accounts receive `403` from protected API endpoints.
- [ ] Create a course, a week, and a task; refresh and verify persistence.
- [ ] Mark the task complete from both Tasks and Course views (same record).
- [ ] Start/pause/resume/finish a focus session; verify history after refresh.
- [ ] Drive status shows configured; Google OAuth returns to Study Hub.
- [ ] Select Goodnotes backup, scan, manually confirm a suggested association.
- [ ] Read a PDF in the in-app viewer, including a file **larger than 4.5 MB** (streaming response).
- [ ] Reopen a PDF and confirm the manually saved reading page is retained.
- [ ] After a Drive access token expires (typically around an hour), scanning still works without another OAuth prompt.
- [ ] Check browser network console and Vercel runtime logs for unexpected errors.

## Important notes

- The cloud Firestore database starts empty. Existing **local SQLite data is not automatically migrated**. Keep your local database as backup until a deliberate import is built.
- Existing Goodnotes files remain in your Google Drive. Study Hub stores metadata and encrypted OAuth tokens, not permanent PDF copies.
- Automatic background Goodnotes synchronization is not yet available; scanning is manual.
- Vercel Services is Beta. Check its deployment logs for schema/build compatibility before relying on it daily. If your account cannot use Services, an alternative is two Vercel projects for the same repo with separate root directories; this requires configuring a separate `NEXT_PUBLIC_API_URL`, CORS, and OAuth callback.
- `npm install` could not be completed in the source-generation environment due to network/DNS restrictions. Vercel will need to resolve npm and Python dependencies when it builds. No complete cloud build or real OAuth test has been run here.
- For any OAuth failure, compare the exact redirect URI **in Google Cloud**, **Vercel env**, and **browser**. The scheme, hostname and path must be identical.

References: https://vercel.com/docs/services ; https://vercel.com/docs/frameworks/backend/fastapi ; https://firebase.google.com/docs/auth/web/google-signin ; https://support.google.com/cloud/answer/15544987 ; https://developers.google.com/identity/protocols/oauth2
