import type { Snapshot } from './types';

export type SnapshotCollection = keyof Snapshot;
export type MutationHint = { collection: SnapshotCollection; deleteId?: string; bulkInsert?: boolean; removeWithLinks?: boolean; detachLinks?: boolean } | { collection: 'none' };

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
  if (hint.detachLinks) {
    const {resource,items}=resourceDetachRows(result);
    const updates=new Map(items.map(row=>[row.id,row]));
    return {...snapshot,resources:snapshot.resources.some(r=>r.id===resource.id)?snapshot.resources.map(r=>r.id===resource.id?resource:r):[...snapshot.resources,resource],items:snapshot.items.map(row=>updates.get(row.id)||row).concat(items.filter(row=>!snapshot.items.some(i=>i.id===row.id)))};
  }
  if (hint.removeWithLinks) {
    const rows = resourceRemovalRows(result, hint.deleteId);
    const updates = new Map(rows.map(row => [row.id, row]));
    return {...snapshot, resources:snapshot.resources.filter(row=>row.id!==hint.deleteId),
      items:snapshot.items.map(row=>updates.get(row.id)||row).concat(rows.filter(row=>!snapshot.items.some(item=>item.id===row.id)))};
  }
  const collection = hint.collection;
  const existing = snapshot[collection] as Identified[];
  if (hint.bulkInsert) {
    const rows = bulkMutationRows(result);
    const ids = new Set(existing.map(row=>row.id));
    return {...snapshot, [collection]: [...existing, ...rows.filter(row=>!ids.has(row.id))]};
  }
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

export function bulkMutationRows(result:unknown): Identified[] {
  if (!result || typeof result!=='object' || !('items' in result) || !Array.isArray(result.items)
      || result.items.some(row=>!row || typeof row.id!=='string' || !row.id)) {
    throw new Error('Unexpected bulk save response. Refresh to verify your activities.');
  }
  return result.items;
}

export function resourceRemovalRows(result:unknown, expectedId?:string): Snapshot['items'] {
  if (!expectedId || !result || typeof result!=='object' || !('resource_id' in result) || result.resource_id!==expectedId
      || !('items' in result) || !Array.isArray(result.items)
      || result.items.some(row=>!row || typeof row.id!=='string' || !row.id || row.resource_id!==null)) {
    throw new Error('Unexpected resource removal response. Refresh to verify the saved state.');
  }
  return result.items;
}

export function resourceDetachRows(result:unknown): {resource:Snapshot['resources'][number];items:Snapshot['items']} {
  if (!result || typeof result!=='object' || !('resource' in result) || !result.resource || typeof result.resource!=='object' || !('id' in result.resource) || typeof result.resource.id!=='string' || !('items' in result) || !Array.isArray(result.items) || result.items.some(row=>!row||typeof row.id!=='string'||row.resource_id!==null)) throw new Error('Unexpected detach response. Refresh to verify the saved state.');
  return result as {resource:Snapshot['resources'][number];items:Snapshot['items']};
}
