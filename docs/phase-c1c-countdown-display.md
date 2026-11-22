# Study Hub v0.5 — Phase C1c: Timed Focus countdown

Apply on top of the **Phase C1b stable timer and its TS322 interval-type fix**, on the existing `feature/v0.5-tasks-calendar` branch.

## Display behavior

- **25 / 50 / 90 min modes:** Focus page and top-bar chip show time **remaining**, starting at the selected target and counting down to `00:00:00`.
- **Stopwatch (`free`) mode:** Both continue counting upward from `00:00:00`.
- **Countdown ring:** Starts full, drains smoothly toward zero, and freezes on Pause. The Stopwatch ring continues filling/repeating every minute.
- **Pause / Resume:** Freeze and resume the same shared local clock from the exact displayed whole second, without resetting the time origin from the API response.
- **Goal reached:** Display clamps at `00:00:00` and shows **TARGET REACHED**; the session is **not** auto-finished. The user must finish/review it.
- **Persisted study duration / statistics:** Remain based on real elapsed unpaused seconds, **not** remaining countdown seconds. No API or Firestore schema changes.

## Local checks

```powershell
cd web
npm ci
npm test
npm run lint
npm run build
```

## Preview acceptance

1. Start 50 min: `00:50:00`, then `00:49:59` after one complete second; ring starts full and drains.
2. Pause at `00:49:39`: it remains `00:49:39` as long as paused; top bar and Focus page match.
3. Resume: it remains `00:49:39` initially and becomes `00:49:38` after another full second.
4. Repeat for 25 and 90 minute modes; verify correct initial values.
5. Stopwatch starts at zero, counts upward, and its ring fills/loops.
6. When the countdown reaches zero, the session remains active until explicitly finished; saved duration is the actual elapsed study time.
7. Test with slow network and background tab; watch for jitter or backward jumps.

No branch merge, deployment, or production Firebase changes are included.
