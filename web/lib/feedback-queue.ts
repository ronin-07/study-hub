export type FeedbackKind = 'success' | 'error' | 'info';

/** Preserve errors when the notification stack is full, and suppress duplicate titles. */
export function appendFeedback<T extends { title: string; kind?: FeedbackKind }>(previous: readonly T[], incoming: T): T[] {
  const next = [...previous.filter(message => message.title !== incoming.title || message.kind !== incoming.kind), incoming];
  if (next.length <= 3) return next;
  const firstNonError = next.findIndex(message => (message.kind ?? 'info') !== 'error');
  next.splice(firstNonError < 0 ? 0 : firstNonError, 1);
  return next;
}

export function feedbackDismissDelay(kind: FeedbackKind = 'info', hasAction = false): number | null {
  // Undo deserves time to be discovered; errors with Retry stay until dismissed.
  return kind === 'error' ? null : hasAction ? 8000 : kind === 'success' ? 3500 : 5500;
}
