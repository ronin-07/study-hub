# Changelog

Historical version families below are reconstructed from prior engineering notes, not verified Git tags or release dates. Current frontend package and API metadata still declare 0.5.0; do not create retroactive tags. See [release workflow](CONTRIBUTING.md#releases).

## Unreleased

### Changed
- Separate Python runtime and development dependency inputs and generated locks; CI installs the locked dependencies and no longer installs unpinned test or audit tools separately. Validate generated locks on Windows and Linux before release.
- Standardize development, CI and hosted runtime targets on Node.js 24 LTS and Python 3.12; configure CI dependency download caching and runtime reporting. Target-runtime regression and deployment verification required before release.
- Consolidated README, architecture, deployment, testing and performance documentation; retired superseded milestone notes after preserving durable design and measurements in maintained guides.
- Added safe configuration examples, contributor guidance, screenshot capture plan and asset provenance review.
- Added MIT source-code license; public asset clearance and final security review remain pending.

### Security
- Previous private repository cleanup, credential rotation and migration were reported complete by the maintainer. Current CI includes staged credential checks, Gitleaks, npm and Python audits; not a new security certification. The former repository remains archived/private and must not be imported.

## v0.6.x — Activity, exam and resource improvements

- Weekly activity generator with selected weeks, custom types, duplicate-safe retry and separate assignments/exercises.
- Exam Command Center: derived exam dates, separate revision progress, paper/solution pairing, attempts and practice tasks/timers.
- Exam interface follow-ups: year/date sorting, search/attempt filters, stable layout, simplified cards, single new solution pairing (preserving legacy links), accessible controls and independent progress celebration.
- Resource management: bulk linking, safe unlink/removal with dependency preview, and permanent archived-course deletion with fingerprint and history safeguards.
- Home completion timestamp and local-day denominator fix; preserve existing activity state and recurrence.
- Firebase efficiency: scoped queries, create-only writes, compact Focus summary, 30-minute visibility refresh, recurrence response with successor and local diagnostics. Historical fake-adapter evidence in [performance](docs/performance.md).

## v0.5.2 — Consistency and PDF performance

- Refined Home/Study, Tasks/Calendar, Focus/Resources and consistent workspace widths, highlights, tooltip/sidebar interactions and feedback.
- Calendar refresh, course-week navigation and task visibility corrections; shared progress and dates preserved.
- PDF opening overlay, cancellation/single-open protection and retry; browser-native PDF preview and saved reading positions.
- Validated tab-memory PDF reuse, deferred Drive discovery and loading. Historical controlled benchmark in [performance](docs/performance.md).

## v0.5.1 — Adaptive interface

- Consistent desktop workspace widths and readable checklist presentation, overview hierarchy and mobile Safari sidebar refinements.
- Study/Tasks readability, questions and layout corrections.

## v0.5.x — Tasks, Calendar and stability

- Unified task/activity records, personal tasks, scheduling, recurrence and calendar navigation.
- Registered semesters, owner authorization and isolated hosted configuration; transactional workspace and Focus guards.
- Optimistic completion, targeted snapshot updates, compact statistics and change-only Drive index writes.
- Stable Focus clock/countdown, feedback, milestone and progress animations, photo-backed empty states, resource and course menus.
- Automated regression and security checks, save notifications and production release gates.

## v0.4.x — Course workspace

- Semester navigation, course/weekly planner, shared course library, archive/restore and resource links.
- Course and week validation, local persistence and focused acceptance tests.

## v0.3.x — Initial study workspace

- Study planner, weekly activities, Focus and Google Drive/Goodnotes PDF discovery, manual linking, in-app preview and reading positions.
- Next.js/FastAPI services, local SQLite and hosted Firebase configuration.
