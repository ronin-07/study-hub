# Contributing

Study Hub is currently private and owner-authorized in hosted mode. Work with synthetic local data; do not access personal deployment accounts. Follow the [README](README.md) to start and [testing guide](docs/testing.md) to validate.

## Workflow

1. Start from a clean, up-to-date `main`; create a dedicated `feature/<milestone>` or `fix/<description>` branch.
2. Agree on design and scope before changing application behavior. Keep changes focused; preserve security boundaries, shared data contracts and existing UI conventions.
3. Add or update regression tests for changed behavior. Use local SQLite and simulated adapters for regular tests, isolated Preview for cloud checks. Never use Production records in automated destructive tests.
4. Update maintained documentation and the `Unreleased` changelog rather than creating per-polish notes. Review asset provenance and never commit real study data or env files.
5. Stage intended paths, run credential scan, test/build and audits, inspect the diff; push branch and open a pull request to protected `main`.
6. Record exact commit, checks and limitations. Require CI and isolated Preview acceptance plus maintainer approval before merge; smoke-test Production afterward. No force-push or direct-main bypass.

Keep sage-green accents, responsive layouts, predictable filtering, feedback and keyboard/reduced-motion support. Report vulnerabilities privately via [SECURITY.md](SECURITY.md).

## Runtime and dependencies

Use Node.js 24 LTS and Python 3.12. Keep the web package engine, `.nvmrc`, backend `.python-version`, CI and hosted runtimes aligned by supported release line. Use `npm ci` for clean installs; make intentional dependency updates with npm and commit the generated lockfile together with the manifest. Preserve existing security overrides until their removal is justified and tested. Python direct dependencies are declared in `backend/requirements.in`; development tools in `backend/requirements-dev.in`. Generate both pip-compatible locks using uv on Python 3.12, with the development resolution constrained by the production lock. Do not edit generated pins manually. From `backend/`, with uv available:

```powershell
uv --version
uv pip compile requirements.in --universal --python-version 3.12 --no-python-downloads --default-index https://pypi.org/simple -o requirements.txt
uv pip compile requirements-dev.in --universal --python-version 3.12 --no-python-downloads --default-index https://pypi.org/simple -c requirements.txt -o requirements-dev.txt
```

Stop if either command fails. Check that the production lock excludes pytest and pip-audit, review all resolved changes, test clean installs on Windows and Linux CI, and commit both inputs and both generated locks together. Record the uv version used. These commands avoid an intentional blanket upgrade; use an explicit reviewed upgrade when needed. Universal resolution includes platform markers and is not a substitute for testing each target platform. Production installation continues to use pip-compatible `requirements.txt`; uv is a lock-generation tool, not a new runtime dependency. Keep index URLs free of credentials.

## Releases

Use semantic versioning for agreed release boundaries, with `vMAJOR.MINOR.PATCH` tags and release notes tied to verified commits. Historical notes are not proof of release tags. Before the next tagged release, inspect existing tags and align frontend/API version metadata deliberately; do not manufacture historical tags or change package versions as part of documentation-only work. Move reviewed `Unreleased` entries into a dated release section, record CI and Preview outcomes, then tag the approved merge and publish release notes if appropriate. Keep repository and releases private until the final public-release review. A first public v1.0.0 is a proposal, not a promise.

### Repository metadata (maintainer setup)

Suggested GitHub About description: **Full-stack academic productivity workspace for coursework, exam preparation, task planning, focus tracking and learning resources.**

Suggested topics: `nextjs`, `typescript`, `fastapi`, `python`, `firebase`, `firestore`, `academic-productivity`, `study-planner`, `google-drive-api`, `full-stack`, `vercel`, `student-tools`. Leave Website blank until a safe public demo is approved. Do not add roadmap technologies as implemented topics. These are proposed settings, not a claim they are already configured.
