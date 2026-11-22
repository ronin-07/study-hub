"""Firebase token verification, localhost-only private development mode."""
import json
import os
import asyncio
from dataclasses import dataclass
from functools import lru_cache

from fastapi import Depends, Header, HTTPException, Request


@dataclass(frozen=True)
class User:
    uid: str


@lru_cache(maxsize=1)
def firebase_app():
    import firebase_admin
    if not firebase_admin._apps:
        raw = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON', '').strip()
        if raw:
            from firebase_admin import credentials
            try:
                service_account = json.loads(raw)
                firebase_admin.initialize_app(credentials.Certificate(service_account))
            except (ValueError, TypeError, KeyError) as exc:
                raise RuntimeError('Invalid FIREBASE_SERVICE_ACCOUNT_JSON environment configuration') from exc
        elif os.getenv('VERCEL'):
            # Vercel does not automatically receive Google Cloud ADC.
            raise RuntimeError('FIREBASE_SERVICE_ACCOUNT_JSON is required on Vercel')
        else:
            firebase_admin.initialize_app()
    return firebase_admin.get_app()


async def current_user(request: Request, authorization: str | None = Header(default=None)) -> User:
    mode = os.getenv('STUDY_HUB_AUTH_MODE', 'local')
    if os.getenv('VERCEL') and mode != 'firebase':
        raise HTTPException(503, 'Cloud deployment requires Firebase authentication')
    if mode == 'local':
        host = request.client.host if request.client else ''
        if host not in ('127.0.0.1', '::1', 'localhost', 'testclient'):
            raise HTTPException(403, 'Local mode is restricted to localhost. Use Firebase for deployment.')
        return User('local-owner')

    if mode != 'firebase':
        raise HTTPException(503, 'Unknown authentication mode')
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Sign in required')
    try:
        from firebase_admin import auth
        firebase_app()
        # Keep revocation checks enabled without blocking concurrent API requests.
        claims = await asyncio.to_thread(auth.verify_id_token, authorization[7:], check_revoked=True)
    except Exception:
        raise HTTPException(401, 'Invalid Firebase token') from None
    expected_uid = os.getenv('STUDY_HUB_ALLOWED_UID')
    expected_email = os.getenv('STUDY_HUB_ALLOWED_EMAIL', '').strip().lower()
    if not expected_uid and not expected_email:
        raise HTTPException(503, 'Private deployment requires STUDY_HUB_ALLOWED_UID or STUDY_HUB_ALLOWED_EMAIL')
    if expected_uid and claims.get('uid') != expected_uid:
        raise HTTPException(403, 'Not authorized')
    if expected_email and (claims.get('email', '').lower() != expected_email or not claims.get('email_verified')):
        raise HTTPException(403, 'Not authorized')
    return User(claims['uid'])
