"""Fail CI if tracked source includes an embedded PEM key or non-example Firebase Admin JSON.

This deliberately scans the git index (not local .env files) and prints filenames,
never credential values. Rotate real keys; scanning does not revoke or erase history.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_EXTENSIONS = {'.py', '.md', '.json', '.jsonl', '.yml', '.yaml', '.toml', '.ts', '.tsx', '.js', '.mjs', '.css', '.txt', '.html', '.sh', '.ps1', '.example'}
BEGIN = b'-----BEGIN ' + b'PRIVATE KEY-----'
END = b'-----END ' + b'PRIVATE KEY-----'


def should_check(path: Path) -> bool:
    return path.suffix.lower() in TEXT_EXTENSIONS or '.env' in path.name


def issues(contents: bytes) -> list[str]:
    findings = []
    if BEGIN in contents or END in contents:
        findings.append('embedded unencrypted private key')
    # Real JSON service accounts contain both a key-id string and a private key.
    # The 'example' style env files must contain only comments/placeholders.
    if (re.search(rb'"private_key_id"\s*:\s*"[a-fA-F0-9]{24,}"', contents)
            or re.search(rb'"private_key"\s*:\s*"(?:\\n|-----BEGIN)', contents)):
        findings.append('Firebase service account credential')
    return findings


def main():
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).split(b'\0')
    failures = []
    for raw in paths:
        if not raw:
            continue
        rel = Path(raw.decode('utf-8'))
        full = ROOT / rel
        if not full.is_file() or not should_check(rel):
            continue
        try:
            matches = issues(full.read_bytes())
        except OSError:
            continue
        if matches:
            failures.append(f'{rel}: {", ".join(matches)}')
    if failures:
        print('Credential scan FAILED. Revoke exposed keys and remove secrets from tracked files:')
        for finding in failures:
            print(' -', finding)
        return 1
    print(f'Credential scan passed ({len(paths)} index entries checked for eligible text files).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
