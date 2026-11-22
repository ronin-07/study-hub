import type { Snapshot } from './types';

export type SnapshotCollection = keyof Snapshot;
export type MutationHint = { collection: SnapshotCollection; deleteId?: string } | { collection: 'none' };

type Identified = { id: string };
/** Apply an authoritative API response to the relevant cached collection. */
export function applyMutation(snapshot: Snapshot, hint: MutationHint, result: unknown): Snapshot {
  if (hint.collection === 'none') return snapshot;
  const collection = hint.collection;
  const existing = snapshot[collection] as Identified[];
  if (hint.deleteId) {
    return { ...snapshot, [collection]: existing.filter(row => row.id !== hint.deleteId) };
  }
  if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !result.id) {
    throw new Error(`Unexpected response while saving ${collection}. Refresh to check the saved state.`);
  }
  const updated = result as Identified;
  return { ...snapshot, [collection]: existing.some(row => row.id === updated.id)
    ? existing.map(row => row.id === updated.id ? updated : row)
    : [...existing, updated] };
}
