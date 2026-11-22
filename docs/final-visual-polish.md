# v0.5 — Final visual polish

Apply these changed source files on top of the approved Phase D repository snapshot. No API schema, Firestore rules, or Focus clock calculations are changed.

- Task completion: lightweight checkbox pop and completed-title transitions across Study, Home, Tasks and Calendar. Existing optimistic updates and rollback remain authoritative.
- Progress: CSS progress-width transitions plus isolated numeric animations; the first paint shows exact values without a distracting number count-up. Reduced motion and hidden-tab behavior are respected.
- Focus: a subtle one-shot glow on reaching the 25/50/90 minute target. Countdown, manual ending, and the shared clock are unchanged.
- Empty states: contextual icons for compact cards; compact photographic treatments for larger truly empty views, without changing populated layouts.
- Save feedback: a fixed aria-live notification reflects pending, successful, and failed API saves. The existing detailed error alert remains available.
- Photographs: two original, compressed local WebP assets appear only when the Home courses card, Tasks list, or course resource tabs are empty; not behind populated cards or the Study week hero. No remote requests.

## Verification

Run `npm ci && npm test && npm run lint && npm run build` inside `web`, and `python -m pytest -q` inside `backend`. Test with reduced motion enabled and both light and dark themes. On Preview, validate new/edit/archive course and semester, checkbox rollback, responsive cards, timed Focus target completion, and feedback on failed saves.
