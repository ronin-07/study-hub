/** Presentation-only progress helpers; canonical activity and Focus data stay untouched. */
export const PROGRESS_ANIMATION_MS = 450;

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function easedProgress(from: number, to: number, ratio: number): number {
  const t = Math.max(0, Math.min(1, ratio));
  return from + (to - from) * (1 - Math.pow(1 - t, 3));
}

/** Only celebrate a newly completed non-empty goal; never celebrate on initial mount. */
export function reachedMilestone(previous: number, next: number): boolean {
  return clampPercent(previous) < 100 && clampPercent(next) === 100 && next > 0;
}

/** Count optimistic completions while UI1 temporarily displays their rows as unchecked. */
export function visibleCourseDoneCount(
  projectedDone: number, activityCount: number, displayedTasks: readonly {id: string}[],
  completingIds: ReadonlySet<string>, canonicalDoneIds: ReadonlySet<string>,
): number {
  const extra = displayedTasks.filter(task => completingIds.has(task.id) && canonicalDoneIds.has(task.id)).length;
  return Math.min(activityCount, Math.max(0, projectedDone + extra));
}
