# Security policy

## Reporting a vulnerability

Please use the repository's Security tab and **Report a vulnerability** if private vulnerability reporting is available. If it is not available, request a private reporting channel from the maintainer without including vulnerability details in a public issue.

Include the affected commit or release, steps to reproduce using non-sensitive test data, expected and actual behavior, and potential impact. Do not submit real credentials, personal coursework, database exports, authentication tokens, or other users' information. Do not test against personal production accounts or infrastructure without permission.

## Security boundaries

- Hosted deployments require authentication and server-side owner authorization.
- The browser must not have direct Firestore read or write access. Firebase Admin operations are authorized by the backend and IAM.
- Preview and Production must use separate Firebase projects and credentials. Local development uses loopback-only access and SQLite.
- Cloud credentials and OAuth secrets must remain in protected server-side configuration; never expose them through public frontend variables.
- Run automated tests, secret scanning and dependency audits before merging. Dependency findings must be assessed and fixed or explicitly reviewed before release.

## Credential exposure

Revoke affected credentials promptly, replace them in the deployment configuration, investigate unauthorized use, and remove sensitive material from reachable Git history where needed. A history rewrite does not revoke credentials or remove copies from other clones, forks, pull requests or caches. Do not publish a repository containing unresolved sensitive references.

Security automation reduces risk but does not guarantee the absence of vulnerabilities. Only test with synthetic or authorized data.
