# Study Hub — UX Specification v1

**Status:** Design approved for review, not implemented in RepLap.  
**Date:** 21 November 2026  
**Scope:** Study Tracker + shared Tasks/Calendar + linked Focus Timer inside a future Personal Hub.

## Product intent

Provide a single destination for academic planning, coursework resources, actionable tasks, deadlines, and actual study time. User should be able to determine what is next within seconds and move from planning to focused work in a single action.

## Navigation

- Future Personal Hub main navigation: Home, Fitness (RepLap), Study, Tasks.
- Focus is launched from Study/Tasks and accessible via a floating/quick-start action; it does not need permanent top-level bottom navigation.
- Inside Study: Overview, Courses, Course week, Exam prep, study history/insights (secondary).
- Mobile-first layouts; on desktop use two-column course/resource layouts and a task sidebar.

## Screen 1 — Today

**Purpose:** Prioritized action center, not a dashboard of every metric.

**Top-to-bottom layout**
1. Date and greeting with 'Today' heading.
2. A single primary 'Continue studying' card containing the last/next course, week topic, next task, and Start Focus button.
3. Planned for today: tasks with scheduled/planned date of today, with quick complete and focus actions.
4. Upcoming deadlines: the nearest 2–3 due dates, clearly labeled as due dates (not study sessions).
5. Compact weekly focus progress and completed study activity summary.
6. Optional quick-add task action.

**Rules**
- Never duplicate the same task as separate records on Today, Tasks, and Course.
- Order unfinished planned tasks by user pin/priority, deadline proximity, and planned time. Do not pretend the system knows exact urgency without explicit user settings.
- If there are no scheduled items, show a next course action and a useful 'Plan today' button.
- Show an active focus session prominently and allow resumption.
- No repeated detailed fitness metrics: RepLap provides those in Fitness.

## Screen 2 — Course and Weekly Planner

**Purpose:** Every course's learning materials and progress are easy to navigate by teaching week.

**Course overview**
- Course code, full name, semester, current week, next assessment, number of planned teaching weeks.
- Cards for weeks, with topic, percent of study items complete, and separate upcoming assignment indicator.
- Explicit Exam Preparation area, not forced into the last teaching week.
- Editable teaching-week count, dates, titles, and topics; supports nonstandard course structures and cross-week assignments.

**Weekly view layout**
1. Course breadcrumb, week selector, title/topic, optional learning objectives.
2. Week completion progress as completed checkable study items / total checkable study items.
3. Filterable study items under Lecture & slides, Notes, Reading, Revision, Assignments.
4. Each resource item has title, source (upload / link / manually added / potential DTU Learn import), optional reference URL, and a completion checkbox.
5. Study items can be promoted to actionable Tasks. Assignments automatically generate/reuse a linked Task. Revisions and readings are optional in Tasks until scheduled.
6. Tap a linked task to open details or start Focus; due date is visible on assessment items.
7. Notes support rich text/Markdown, attachments and links in later production implementation.

**Progress logic**
- Item marked complete means the user has completed that material/activity; spending focus time never auto-completes it.
- Focus hours, content completion, and assignment submission status are separate.
- For assignments distinguish `work_complete` from `submitted` where practical; do not imply submission to DTU Learn.

## Screen 3 — Tasks and Calendar

**Purpose:** A shared list for academic and personal commitments, without duplicate entries.

**Views**
- Today: items planned for today, plus clearly separated overdue tasks.
- Upcoming: incomplete tasks sorted by due/planned date; optional filters by course, personal, priority.
- Calendar: day/week views indicating planned work vs official deadlines with distinct icons.
- Completed: archived tasks and completion history (secondary).

**Task fields**
- `title` (required), `description` (optional)
- `kind`: general / study / assignment / revision / reading
- `course_id` and `week_id` (optional)
- `study_item_id` (optional relationship, never a duplicate task)
- `due_at` (official due date / user-defined deadline)
- `planned_for` (study/work date)
- `priority`, `status`, `subtasks`, `recurrence`, `estimated_minutes` (optional)
- `source`: manual / linked study item / imported external (with provenance)

**Interactions**
- Create tasks from global quick add or within a course/week.
- Completing from either surface updates the same underlying record.
- Users can start Focus against a task; ending Focus does not mark it complete automatically.
- Imported assignment deadlines are not overwritten by rescheduling planned work.
- Repeating tasks are supported for personal chores and study routines after MVP.

## Screen 4 — Focus

**Purpose:** Lower the friction from deciding to study to actually studying.

**Start flow**
- Launch from course, week, task, or quick start.
- Prefill course and linked task when context exists; allow unlinked general focus.
- Select preset 25/5, 50/10, 90/custom, or free stopwatch.
- One dominant Start/Pause/Resume/Finish control area; avoid duplicate timer controls.

**Active flow**
- Display countdown/count-up, selected task, progress indicator, pause/resume, and finish.
- Separately account for breaks. Paused time is excluded.
- A single active focus session per user; explicit handoff/resume flow across devices.
- Persist start time, accumulated active duration, pauses and revision information so unexpected closures do not blindly count all idle time.

**Finish flow**
- Show actual focused duration; optionally adjust or discard with an audit-friendly log.
- Offer `Continue later`, `Mark linked task complete`, `Start next session`.
- Store `course_id`, `week_id`, `task_id`, session type, focus duration, break duration, start/end timestamps, and manual adjustments.
- Reaching a timer target does not automatically complete an academic task.

**Focus analytics**
- Total daily / weekly study hours and target.
- By course, week, task, study activity.
- Do not treat study hours as a measure of mastery or inflate progress checklists.

## Shared data model

```text
User
 ├── Semester
 │    └── Course
 │         ├── CourseWeek
 │         │    └── StudyItem (lecture / notes / reading / revision)
 │         ├── Assignment
 │         └── ExamPrep
 ├── Task (optional link to Course / Week / StudyItem / Assignment)
 ├── FocusSession (optional link to Task / Course / Week)
 ├── StudyGoal (daily / weekly)
 └── IntegrationSource (calendar / Brightspace when authorized)
```

**Canonical write rules**
- Task completion has one authoritative status field in `Task`; linked surfaces read the same task ID.
- Resource/lecture completion lives in `StudyItem`. When an actionable task represents completing that item, define one explicit status mapping (not competing independent checkboxes).
- Assignments may have stages (draft, ready, submitted) and an optional linked Task; no claimed external submission unless integration confirms it.
- FocusSession logs duration and linkage, never mutates study mastery/completion automatically.

## DTU Learn strategy

- V1: manually set up courses and weeks; upload PDFs and attach external URLs; create assignments and due dates.
- V1.1: authorized calendar subscription/import for course events if exposed; preserve import provenance and handle updates without overwriting user planning.
- Later: explore authorized DTU Learn/Brightspace access to course structure, content, and assignments. Access is unverified and is not an MVP prerequisite.
- Do not scrape private content or assume unrestricted API permission.

## Visual system

- Calm neutral surfaces with one teal/green accent reserved for focus/start and progress, not a rainbow for every category.
- Hierarchy: one prominent action per screen, readable headings, concise labels, cards only when they separate meaningful information.
- Touch targets at least ~44 CSS pixels, high contrast, keyboard access, screen reader labels for progress and icon actions.
- One-column mobile layout; desktop keeps course resources visible next to week outline or task details.
- Status differences use text and shape, never color alone.
- Empty/loading/error states are designed deliberately; do not display fabricated progress before loading.

## Key example flows to validate

1. Open Course Week 10, complete 'Write lecture notes', go to Tasks: same task is complete.
2. Create assignment with due Friday and planned work Tuesday: both dates appear distinctly in Calendar.
3. Start Focus from an assignment: course and assignment preselected; pause and breaks are not counted as focus.
4. End Focus: time is logged but assignment stays unfinished until user chooses to complete it.
5. Add an unscheduled reading resource: visible in course, not automatically cluttering global Tasks.
6. Open app during an active session: Today provides Resume Focus instead of new competing timer.
7. Switch to a course with a nonstandard number of weeks: navigation follows its actual structure.

## MVP acceptance criteria

- Course setup and weekly views with editable resources and checklists.
- Shared Tasks with planned date versus due date, and links from study work.
- Focus session lifecycle with accurate active-time accounting and recovery policy.
- Responsive, accessible mobile and desktop layouts.
- Independent analytics for completion, actual time, and deadlines.
- No changes to existing RepLap workout records or in-progress fitness UX scope.

## Deferred decisions

- Native vs PWA notification behavior and offline storage policy.
- Rich text editor/library choice; PDF annotation and document versioning.
- Exact Brightspace integration subject to DTU permissions.
- AI notes, spaced repetition, readiness estimates and auto-scheduling.
- Apple Reminders synchronization; use Apple's grocery lists separately initially.

**Next milestone:** Review these four screens for navigation, data density and interaction details; then freeze the design contract and implement a new isolated Study module without destabilizing RepLap.
