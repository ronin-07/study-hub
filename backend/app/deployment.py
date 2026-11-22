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
    if os.getenv('VERCEL_ENV') == 'preview':
        preview = os.getenv('STUDY_HUB_PREVIEW_FIREBASE_PROJECT_ID')
        production = os.getenv('STUDY_HUB_PRODUCTION_FIREBASE_PROJECT_ID')
        if not preview or not production or preview == production or project_id != preview:
            raise RuntimeError('Preview must use a distinct, explicitly identified Firebase project')
        if os.getenv('STUDY_HUB_ALLOW_PREVIEW_DRIVE_OAUTH') != 'true':
            # No preview OAuth tokens from production: endpoints guard independently.
            return


def require_drive_available():
    if os.getenv('VERCEL_ENV') == 'preview' and os.getenv('STUDY_HUB_ALLOW_PREVIEW_DRIVE_OAUTH') != 'true':
        from fastapi import HTTPException
        raise HTTPException(503, 'Drive OAuth is disabled for isolated preview deployments')
