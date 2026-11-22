"""Fail-closed environment checks for public cloud and isolated Vercel previews."""
from __future__ import annotations

import json
import os


def validate_deployment_environment():
    if not os.getenv('VERCEL'):
        return
    if os.getenv('STORAGE_BACKEND') != 'firestore' or os.getenv('STUDY_HUB_AUTH_MODE') != 'firebase':
        raise RuntimeError('Vercel requires Firestore and Firebase auth')
    if not (os.getenv('STUDY_HUB_ALLOWED_UID') or os.getenv('STUDY_HUB_ALLOWED_EMAIL')):
        raise RuntimeError('Vercel requires an authorized user allowlist')
    raw = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON', '')
    if not raw:
        raise RuntimeError('Firebase service-account secret required')
    try:
        project_id = json.loads(raw)['project_id']
    except (ValueError, KeyError, TypeError) as exc:
        raise RuntimeError('Invalid Firebase service-account configuration') from exc
    environment = os.getenv('VERCEL_ENV')
    if environment not in ('preview', 'production'):
        raise RuntimeError('Unknown hosted environment; refusing to initialize Firebase')
    preview = os.getenv('STUDY_HUB_PREVIEW_FIREBASE_PROJECT_ID', '').strip()
    production = os.getenv('STUDY_HUB_PRODUCTION_FIREBASE_PROJECT_ID', '').strip()
    if not preview or not production or preview == production:
        raise RuntimeError('Preview and Production require distinct, explicitly configured Firebase projects')
    expected = preview if environment == 'preview' else production
    if project_id != expected:
        raise RuntimeError('Service account does not match expected Firebase project for this environment')
    web_project = os.getenv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', '').strip()
    if not web_project or web_project != expected:
        raise RuntimeError('Web Firebase project ID does not match this deployment environment')



def require_drive_available():
    if os.getenv('VERCEL_ENV') == 'preview' and os.getenv('STUDY_HUB_ALLOW_PREVIEW_DRIVE_OAUTH') != 'true':
        from fastapi import HTTPException
        raise HTTPException(503, 'Drive OAuth is disabled for isolated preview deployments')
