import type { Snapshot } from './types';

export type SnapshotCollection = keyof Snapshot;
export type MutationHint = { collection: SnapshotCollection; deleteId?: string } | { collection: 'none' };

type Identified = { id: string };
type WorkspaceCollection = Exclude<SnapshotCollection, 'sessions' | 'focus_stats'>;
export type SnapshotChanges = Partial<Record<WorkspaceCollection, Set<string> | 'all'>>;

/** The network response can predate local writes made while it was loading. */
export function preserveWorkspaceChanges(
  incoming: Snapshot,
  current: Snapshot,
  changes: SnapshotChanges,
  pendingItems: ReadonlySet<string>,
): Snapshot {
  const itemChanges = changes.items === 'all' || pendingItems.size === 0
    ? changes.items
    : new Set([...(changes.items ?? []), ...pendingItems]);
  return {
    ...incoming,
    items: preserveRows(incoming.items, current.items, itemChanges),
    courses: preserveRows(incoming.courses, current.courses, changes.courses),
    weeks: preserveRows(incoming.weeks, current.weeks, changes.weeks),
    resources: preserveRows(incoming.resources, current.resources, changes.resources),
    semesters: preserveRows(incoming.semesters, current.semesters, changes.semesters),
  };
}

function preserveRows<T extends Identified>(incoming: T[], current: T[], changes?: Set<string> | 'all'): T[] {
  if (changes === 'all') return current;
  if (!changes?.size) return incoming;

  const local = new Map(current.filter(row => changes.has(row.id)).map(row => [row.id, row]));
  const rows: T[] = [];
  for (const row of incoming) {
    if (!changes.has(row.id)) rows.push(row);
    else {
      const updated = local.get(row.id);
      if (updated) rows.push(updated);
      local.delete(row.id);
    }
  }
  return rows.concat([...local.values()]);
}

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
