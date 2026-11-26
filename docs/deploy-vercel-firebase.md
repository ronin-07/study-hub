# Deployment and configuration

[Home](../README.md) · [Architecture](architecture.md) · [Release gates](testing.md)

The existing application uses Vercel Services at the repository root, with `web/` and `backend/` configured in `vercel.json`. Keep the existing project, URLs and Firebase data. Runtime changes do not require changing secrets, Firestore rules or billing plans. Never reconnect an archived or compromised repository.

## Runtime alignment

The web service targets Node.js 24.x (`web/package.json` engines); the API service targets Python 3.12 (`backend/.python-version`). The root `.nvmrc` selects the Node major for local version managers. CI uses the same release lines. Patch versions can differ; record the versions from each deployment. Verify the actual web and API runtimes in Vercel Preview build logs before approving a merge. If the web service does not honor its package engine, review the project Node.js setting (24.x) and its scope before changing it; avoid changing Production settings during Preview validation. Verify Production after merge. Keep `vercel.json`, service roots, credentials and Firebase project isolation unchanged.

## Backend dependencies

The API service root is `backend/`. Its production manifest remains `requirements.txt`, generated from `requirements.in` with Python 3.12 as the resolution target. Development and audit tools belong to `requirements-dev.txt`, which includes the runtime dependency set and is constrained by the production lock. Do not configure Vercel to install the development lock. Verify the actual installation in Preview logs and smoke-test the API; no runtime setting, secret or database migration is required for this dependency split. See [dependency workflow](../CONTRIBUTING.md#runtime-and-dependencies).

## Environment matrix

| Setting | Local | Preview | Production |
| --- | --- | --- | --- |
| `STUDY_HUB_AUTH_MODE` | `local` | `firebase` | `firebase` |
| `STORAGE_BACKEND` | `sqlite` | `firestore` | `firestore` |
| `SQLITE_PATH` | ignored local path | unset | unset |
| `NEXT_PUBLIC_STUDY_HUB_AUTH_MODE` | `local` | `firebase` | `firebase` |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:8000` | `/` | `/` |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | unset | Preview web app | Production web app |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | unset | Preview server credential | Production server credential |
| `STUDY_HUB_ALLOWED_UID` and/or `STUDY_HUB_ALLOWED_EMAIL` | unset | test owner | production owner |
| `STUDY_HUB_PREVIEW_FIREBASE_PROJECT_ID` | unset | expected Preview ID | expected Preview ID |
| `STUDY_HUB_PRODUCTION_FIREBASE_PROJECT_ID` | unset | expected Production ID | expected Production ID |
| `STUDY_HUB_ALLOW_PREVIEW_DRIVE_OAUTH` | unset | `false` unless separately approved | unset |
| `CORS_ORIGINS` | loopback defaults | exact origin if needed | exact origin if needed |
| `STUDYHUB_DB_DIAGNOSTICS` | optional `1` with test Firestore only | unset | unset |

Both expected project ID variables must be set and distinct in each hosted environment. Web configuration is browser-visible by design; Admin JSON, Google OAuth secrets and encryption keys must never use `NEXT_PUBLIC_`. If both owner restrictions are set, both are enforced; email must be verified. Vercel-provided `VERCEL` and `VERCEL_ENV` must not be manually spoofed. Backend examples are reference templates, not automatically loaded by Python. Next.js loads `web/.env.local` if created from its safe example. Never overwrite existing working env files.

## New isolated installation (not needed for an existing deployment)

1. Create two dedicated Firebase projects. Enable Google sign-in and register a web application in each. Create Firestore in the desired region (region choice is difficult to reverse).
2. Publish [deny-all client rules](firestore.rules) **only** in the dedicated Study Hub projects. The backend uses Admin SDK/IAM; grant the service identities only required access. Do not replace another application's rules.
3. Create and securely store separate server credentials; configure the full JSON only in the protected server environment. Never commit or paste it into public issues. Set the owner restriction and project IDs from the matrix.
4. Import the correct private GitHub repository into Vercel, keeping root directory at repository root so Services config is recognized. Assign distinct Preview and Production variables. Production branch is `main`.
5. Add exact approved stable hostnames to Firebase Authentication authorized domains (without scheme). Use a stable Preview hostname if a Preview OAuth integration is needed; do not authorize arbitrary ephemeral hostnames.
6. Deploy through the approved GitHub PR process. Verify `/health` returns `firestore` and `firebase`, then verify owner access and non-owner rejection separately. Check Vercel service logs privately if startup fails; never print credentials. No automatic SQLite-to-Firestore import exists.

## Optional Google Drive OAuth

Use a separately configured Google Cloud OAuth web application with Drive API enabled, the minimal supported read-only scope and authorized consent/test users appropriate for the account. Firebase sign-in and Drive permission are different. Register the exact callback `https://<approved-host>/api/drive/callback`.

| Server variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Drive OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Drive OAuth secret |
| `GOOGLE_REDIRECT_URI` | Exact registered callback |
| `WEB_URL` | Approved origin for return redirect |
| `APP_SIGNING_SECRET` | Strong independent random signing secret |
| `OAUTH_ENCRYPTION_KEY` | Fernet key (URL-safe base64 of 32 random bytes) |

Generate keys locally, never copy them into documentation or logs. Use separate values for signing and encryption; retain the encryption key securely across deployments or stored tokens will require reconnection. Example generation commands (run privately in the configured Python environment):

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Enable Preview Drive only with separate test credentials and synthetic files, and explicitly set `STUDY_HUB_ALLOW_PREVIEW_DRIVE_OAUTH=true`. Never reuse Production secrets. OAuth consent and refresh-token lifetime depend on Google project configuration; reconnection may be necessary if tokens expire or are revoked. Connect from Resources, select a backup folder, scan and manually confirm links. PDFs remain in Drive; the backend stores metadata and encrypted tokens. Test reauthorization, repeat scans, access denial, larger PDFs and bookmarks in isolated Preview. See [testing](testing.md).

## Release and rollback

Push only the milestone branch, review CI and the exact Vercel Preview commit, obtain approval, merge through protected `main`, then smoke-test Production. Do not test destructive operations against real study records. Use a normal revert PR if necessary; an approved Vercel rollback may be used to restore service while the Git revert is prepared. Do not rewrite history, force-push, reset data or rotate stable OAuth keys for a documentation-only change. A change to environment values generally requires redeployment; no such change is required by this milestone.
