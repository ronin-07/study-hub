import type { DriveIndexed, Resource } from './types';

export type IndexedPdfFilter = 'unlinked'|'suggested'|'linked'|'all';

export function driveLinksByFile(resources: Resource[]) {
  const links = new Map<string, DriveIndexed['links']>();
  for (const resource of resources) {
    if (resource.source !== 'drive' || !resource.drive_file_id) continue;
    const link = { resource_id: resource.id, course_id: resource.course_id, week_number: resource.week_number };
    const existing = links.get(resource.drive_file_id);
    if (existing) existing.push(link);
    else links.set(resource.drive_file_id, [link]);
  }
  return links;
}

/** Filter only: never deduplicate by name or alter underlying Drive file IDs. */
export function filterIndexedPdfs(files: DriveIndexed[], filter: IndexedPdfFilter, search: string): DriveIndexed[] {
  const term = search.trim().toLowerCase();
  return files.filter(file => {
    const linked = file.links.length > 0;
    const matches = filter === 'all' || (filter === 'linked' ? linked
      : filter === 'suggested' ? !linked && !!file.suggestion : !linked);
    return matches && (!term || `${file.name} ${file.path}`.toLowerCase().includes(term));
  });
}
