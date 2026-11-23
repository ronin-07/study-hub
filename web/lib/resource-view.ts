import type { DriveIndexed } from './types';

export type IndexedPdfFilter = 'unlinked'|'suggested'|'linked'|'all';

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
