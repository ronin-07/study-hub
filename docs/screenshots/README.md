# Application screenshot capture plan

No authentic screenshots have been captured for this documentation update. This directory is tracked so real screenshots can be added after review; do not use wireframes or generated images as evidence of application behavior.

## Synthetic workspace

Start a fresh local SQLite workspace with a separate path (`SQLITE_PATH=./data/demo.sqlite3` in the API process) and loopback authentication. Stop the running local API before starting the demo instance. Do not copy a real database or use Production. Create records through the existing UI; no seeding code is added.

- Semester: Demo Semester; courses `DEMO101` Applied Computing, `DEMO202` Mathematical Methods, `DEMO303` Data Analysis. Use fictional titles and dates relative to capture day.
- Create 13 weeks per course, selected generated activities, mixed complete/incomplete work, due and planned dates, one repeating task, one upcoming exam, and a few recorded Focus sessions. Include one paper, one solution and sample attempt using non-private links; avoid claims of actual grade performance.
- For real PDF screenshots only, use an isolated approved Drive connection with a self-created synthetic PDF. Local external links can show resource organization without Drive; never pretend a mock link is a working PDF preview.

## Capture set

| File | View | Capture goal |
| --- | --- | --- |
| `01-home.webp` | Home | Hero: daily priorities and courses |
| `02-study.webp` | Study | Week planner and activities |
| `03-exam-prep.webp` | Exam Prep | Papers, paired solution and attempts |
| `04-calendar.webp` | Calendar | Planned work, deadlines and exam |
| `05-focus.webp` | Focus | Timer and statistics |
| `06-resources.webp` | Resources | Resource organization |

Use consistent 1440 × 900 or 1920 × 1080 viewport, browser zoom and light theme. Capture application content only, no browser chrome/account, notifications, real names, email, hostnames, Drive IDs, or personal course files. Review metadata and rights in [asset credits](../asset-credits.md). Once reviewed, add the first three actual images to the README (Home hero, Study and Exam Prep), with descriptive alt text and relative links; link the other views here. No broken image paths before capture. Do not use an owner-only live deployment as public demo. Restart the normal local API with its original configuration after capture.
