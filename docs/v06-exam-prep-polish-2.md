# Study Hub v0.6 Exam Prep Polish 2

## Apply on main

This archive applies after Exam Prep Polish 1. It contains 22 changed or new files, including these instructions. The implementation baseline was reconstructed from the v0.6 handoff and its follow-up archives through Exam Prep Polish 1. All ten entries in the Polish 1 archive matched the baseline byte for byte. Remote Git state was unavailable in the archive workspace.

1. In your existing Study Hub checkout, switch to `main` and check that the working tree is clean. Confirm that it includes Polish 1 and the preceding resource-management and safety changes. Review any changes made since Polish 1 to paths in this ZIP before copying them over.
2. Extract the ZIP into the repository root, keeping its `backend/`, `web/`, and `docs/` paths.

   ```powershell
   git switch main
   git status --short
   Expand-Archive -LiteralPath 'C:\path\to\studyhub-v0.6-exam-prep-polish-2.zip' -DestinationPath . -Force
   git diff --check
   ```

3. Run the web checks from `web/` and the backend checks from `backend/`. Use your local test environment or the equivalent CI settings.

   ```powershell
   Push-Location web
   npm ci --no-audit --no-fund
   npm test
   npm run lint
   npm run build
   Pop-Location

   Push-Location backend
   python -m pip install -r requirements.txt
   python -m pytest -q
   python -m compileall -q app
   Pop-Location
   ```

4. Review the frontend and backend changes together before committing. The custom timer and direct unpair action require the matching backend. No database migration, Firebase or Vercel settings changes, or additional services are needed.

## Behavior

- The revision checklist and past papers sit side by side on wide screens and stack on narrow screens. Exam Focus and Exam Resources are grouped below. Coursework and revision each celebrate completion in their own panel. Completion messages remain available with reduced motion.
- Papers sort by year and then season. Oldest first uses Winter, Spring, Summer, Autumn. Newest first reverses that order. Within a year, papers with an unknown season follow dated seasons. Papers with an unknown year stay at the bottom. Search matches the display name, filename and year. Attempt and missing-solution filters combine with search.
- Question papers, solutions, attempts and practice are directly accessible on each card. The three-dot action menu supports keyboard navigation and opens the existing safe confirmation for removal. To replace a solution, unpair it and then link its replacement. Both resource records and their saved pages are preserved by unpairing.
- Each paper accepts one new solution association. Existing papers with multiple solutions keep each one. Existing solution links can still be opened, edited, unpaired or removed individually. Bulk linking reserves a destination once within a batch. Backend create, edit, pair and bulk operations enforce the limit transactionally.
- Practice uses a 1–720 minute countdown or a stopwatch. Countdown initially uses the course exam duration when available. Continue to Focus prepares the existing linked practice task, and Start focusing begins the session. An active or paused session can be reopened from the practice dialog. Attempts remain recorded explicitly in attempt history.

## Verification on the supplied source

- Web tests passed 240/240. TypeScript and the production Next.js build passed.
- Backend tests passed 172. Three existing environment-example tests failed on both the Polish 1 baseline and this release because they require Git tracking information. All resource removal, unlink, rollback, concurrency, course deletion and Focus tests passed using SQLite and a simulated Firestore adapter.
- Local Microsoft Edge checks exercised desktop and 390 px mobile layouts, dark and light themes, sorting and filtering, separate celebrations and reduced motion, keyboard navigation, removal confirmation and attempt protection, unpairing and re-pairing, single and bulk pairing against simulated Drive discovery, and countdown, pause and stopwatch flows. Link mutations ran against the local API.
- Live Firestore, real Google Drive integration and remote `main` were outside the local verification. No deployment was performed.
