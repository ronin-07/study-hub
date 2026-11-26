# Performance engineering

[Home](../README.md) · [Architecture](architecture.md) · [Testing](testing.md)

## Current optimizations

- Targeted mutation reconciliation, optimistic completion and rollback, recurring successor response; no full snapshot after normal edits. Structural mutations are guarded; refresh failure after a successful write is not a failed write.
- Concurrent Firestore collection reads for the initial snapshot (wall-clock improvement, not elimination of collection reads). Compact Focus overview uses current-week, recent and lifetime data rather than all history. Course rename scans related weeks/items/resources only when shrinking week count.
- Token verification keeps revocation checks but offloads blocking work. Timer rendering uses local clock calculations instead of an API call every second. PDF bookmark writes are debounced and serialized (historical 650 ms design); close/visibility flush protects saved position.
- Drive status/index deferred to Resources; visible folder loading and empty-folder reuse; change-only index writes. Visibility-triggered snapshot refresh threshold increased from 30 seconds to 30 minutes; manual refresh unaffected. No polling.
- PDF cache bounded to two files, 64 MiB and ten minutes, revalidated against current permissions and checksum. Streaming and cancellation do not remove the 50 MiB individual preview limit. See [architecture](architecture.md#drive-and-pdf-flow).

## Historical local PDF benchmark (v0.5.2 Stage A)

Source: retired `docs/v0.5.2-stage-a-performance.md` in pre-consolidation history. Five headless Chrome trials per build, viewport 1440 × 900, synthetic 8.47 MB / 520-page PDF, repeatable mocked API. Medians; PDF timing stopped at native viewer frame mount, not the first visible page. Original/Stage A exact benchmark commit IDs, hardware and tail latency were not recorded in that note. Not reproduced on the current source; not production results.

| Metric | Original | Stage A |
| --- | ---: | ---: |
| Home workspace available | 135 ms | 127 ms |
| Home Drive requests | 2 | 0 |
| PDF first open | 1,080 ms | 1,076 ms |
| PDF reopen | 1,079 ms | 93 ms |
| PDF response body on reopen | 8.47 MB | 0 bytes |
| First Resources visit through index readiness | 6 ms | 141 ms |
| Repeat Resources visit through index readiness | 5 ms | 4 ms |

Median reopen reduction ~91.4%. The 304 response still incurs authentication, metadata, HTTP headers and network work. The first Resources visit became slower because work was deferred; first PDF open was effectively unchanged. Study/Tasks first-visit medians held at 12/6 ms; initial gzipped JS grew ~0.5 KiB, CSS unchanged. A separate two-trial screenshot check observed page-region paint at 1.74–1.79 s before and ~0.74 s after on reopen, cold page paint ~1.75–1.94 s across both builds. Too few samples for a robust tail estimate. Historical local checks reported 204 frontend and 118 backend tests, type-check/build and credential scan; live Firebase/Drive and Safari were not measured.

## Historical Firebase efficiency (v0.6 M3A)

Source: retired `docs/v0.6-milestone-3a-firebase-efficiency.md`. Fake adapter scenario: four courses, 234 activities in other courses, 78 new activities in empty target course. Scoped queries, create-only UUID writes, no guard update on empty transactions. Counts are not actual billing or production measurements.

| Operation | Baseline document lookups | After | Writes before/after |
| --- | ---: | ---: | ---: |
| First generation | 236 | 2 + one empty query | 79/79 |
| Repeat generation | 314 | 80 | 1/0 |
| Ordinary activity completion | 2 | 2 | 1/1 |

An empty Firestore query has a minimum read charge (roughly 3 reads in first-generation scenario before other factors). Index charges, retries and query billing affect totals. The 30-second to 30-minute refresh threshold reduces the theoretical maximum visibility-triggered refresh frequency by 98.3%, not total production reads. Historical source reported 220 frontend tests; backend 138 passed, one SDK skip and three missing Git metadata failures, with four added tests passing. Full build not verified in that environment.

## Diagnostics

Inspect `Server-Timing: api;dur=...` and browser request duration separately. For a local backend using an isolated test Firestore project, `STUDYHUB_DB_DIAGNOSTICS=1` logs route templates, duration and estimated point lookups/query documents/staged/direct operations. Disabled by default and under Vercel. Size warnings at 256/512 KiB estimate serialized JSON, not exact Firestore document size. Counts include attempted transaction work and are not committed writes or billing; no live database scan. Do not log private data or enable diagnostics in Production.

## Future repeatable benchmark protocol

Record exact commit(s), operating system, hardware, browser and viewport, runtime versions, data fixture sizes, network conditions, cold/warm state, sample count, individual raw timings, median and p95, failures and limitations. Separate mocked API, local SQLite, isolated cloud integration and production observations. Define user-visible endpoints (initial workspace, navigation, first PDF page paint, reopen, API, transfer bytes, generator, Focus interaction, bundle and memory). Capture first visible page with a reproducible visual criterion, not iframe mount. Use synthetic authorized data, warmup runs, independent trials and equivalent fixtures; include regressions and trade-offs. Preserve authentication and access checks. Benchmark tooling and distributed telemetry remain future milestones, not implemented features.
