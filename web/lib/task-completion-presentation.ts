/** Presentation timing only. Task writes are never delayed for an animation. */
export const COMPLETION_HOLD_MS = 750;
export const COMPLETION_EXIT_MS = 150;
export type CompletionPhase = 'holding' | 'leaving';

/**
 * While a row celebrates completion, keep it in the projections used by active
 * lists. The actual saved task remains `done: true` in the canonical snapshot.
 * Never duplicate a task, and return the original array when idle.
 */
export function presentCompletingItems<T extends { id: string; done: boolean }>(
  items: T[], phases: Readonly<Record<string, CompletionPhase>>
): T[] {
  if (Object.keys(phases).length === 0) return items;
  return items.map(item => item.done && phases[item.id] ? {...item, done: false} : item);
}
