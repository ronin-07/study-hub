"""Fail CI if tracked source includes an embedded PEM key or non-example Firebase Admin JSON.

This deliberately scans the git index (not local .env files) and prints filenames,
never credential values. Rotate real keys; scanning does not revoke or erase history.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
TEXT_EXTENSIONS = {'.py', '.md', '.json', '.jsonl', '.yml', '.yaml', '.toml', '.ts', '.tsx', '.js', '.mjs', '.css', '.txt', '.html', '.sh', '.ps1', '.example'}
PEM_MARKER = re.compile(
    rb"-----" + rb"(?:BEGIN|END) (?:[A-Z0-9]+ )*PRIVATE KEY" + rb"-----"
)
PRIVATE_SUFFIXES = {'.pem', '.key', '.p12', '.pfx', '.jks', '.bundle', '.db', '.sqlite', '.sqlite3'}


def private_path(path: PurePosixPath) -> bool:
    name = path.name.lower()
    if name == '.env' or (name.startswith('.env.') and not name.endswith('.example')):
        return True
    if path.suffix.lower() in PRIVATE_SUFFIXES:
        return True
    return name.endswith('.json') and (
        name == 'credentials.json' or name.startswith('client_secret')
        or any(part in name for part in ('service-account', 'service_account', 'serviceaccountkey', 'firebase-adminsdk', 'oauth-token'))
    )


def should_check(path: Path) -> bool:
    return path.suffix.lower() in TEXT_EXTENSIONS or '.env' in path.name


def issues(contents: bytes) -> list[str]:
    findings = []
    if PEM_MARKER.search(contents):
        findings.append('embedded private key marker')
    # Real JSON service accounts contain both a key-id string and a private key.
    # The 'example' style env files must contain only comments/placeholders.
    if (re.search(rb'"private_key_id"\s*:\s*"[a-fA-F0-9]{24,}"', contents)
            or re.search(rb'"private_key"\s*:\s*"(?:\\n|-----BEGIN)', contents)):
        findings.append('Firebase service account credential')
    return findings


def main():
    entries = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=ROOT).split(b'\0')
    failures = []
    checked = 0
    for raw in entries:
        if not raw:
            continue
        metadata, filename = raw.split(b'\t', 1)
        mode, oid, stage = metadata.split()
        rel = PurePosixPath(filename.decode('utf-8', errors='surrogateescape'))
        if stage != b'0':
            failures.append(f'{rel}: unresolved index entry')
            continue
        if private_path(rel):
            failures.append(f'{rel}: forbidden tracked local or credential file')
            continue
        if mode not in (b'100644', b'100755') or not should_check(rel):
            continue
        try:
            # Read the staged blob, not the possibly different working-tree file.
            contents = subprocess.check_output(['git', 'cat-file', 'blob', oid.decode('ascii')], cwd=ROOT)
        except subprocess.CalledProcessError:
            failures.append(f'{rel}: unable to read staged blob')
            continue
        checked += 1
        matches = issues(contents)
        if matches:
            failures.append(f'{rel}: {", ".join(matches)}')
    if failures:
        print('Credential scan FAILED. Revoke exposed keys and remove secrets from tracked files:')
        for finding in failures:
            print(' -', finding)
        return 1
    print(f'Credential scan passed ({checked} staged text files checked).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
