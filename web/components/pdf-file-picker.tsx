'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, FileText, Folder, HardDrive, Search, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { api } from '@/lib/api';
import { filterPdfChoices, pdfLibraryChoices, type PdfChoice, type PdfLibraryScope } from '@/lib/pdf-library';
import type { StudyPdf } from '@/lib/pdf-study';
import type { Course, DriveEntry, DriveIndexed, DriveList, Resource } from '@/lib/types';

type Props = {
  resources: Resource[];
  courses: Course[];
  indexed: DriveIndexed[];
  tabs: StudyPdf[];
  currentCourseId?: string;
  driveConnected: boolean;
  driveLoading: boolean;
  driveError: boolean;
  user: User | null;
  onRetryDrive: () => void;
  onClose: () => void;
  onChoose: (choice: PdfChoice) => void;
};
const scopes = [
  { id: 'all', label: 'All PDFs' },
  { id: 'course', label: 'This course' },
  { id: 'drive', label: 'Google Drive' },
] as const;

export function PdfFilePicker({ resources, courses, indexed, tabs, currentCourseId, driveConnected, driveLoading,
  driveError, user, onRetryDrive, onClose, onChoose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<PdfLibraryScope>('all');
  const [query, setQuery] = useState('');
  const [browseFolders, setBrowseFolders] = useState(false);
  const choices = useMemo(() => pdfLibraryChoices(resources, courses, indexed, tabs, currentCourseId),
    [resources, courses, indexed, tabs, currentCourseId]);
  const visible = filterPdfChoices(choices, scope, query, currentCourseId);
  const browsing = scope === 'drive' && browseFolders && driveConnected;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    search.current?.focus();
    return () => { if (element.open) element.close(); };
  }, []);

  const openDriveFile = (file: DriveEntry) => {
    const linked = choices.find(choice => choice.fileId === file.id && choice.openKey)
      ?? choices.find(choice => choice.fileId === file.id && choice.courseId === currentCourseId)
      ?? choices.find(choice => choice.fileId === file.id);
    onChoose(linked ?? { id: `drive:${file.id}`, title: file.name, fileId: file.id,
      location: 'Google Drive', search: file.name });
  };

  return <dialog ref={dialog} className="pdf-file-picker" aria-labelledby="pdf-file-picker-heading"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="pdf-file-picker-content">
      <header><h2 id="pdf-file-picker-heading">Open PDF</h2>
        <button type="button" className="btn secondary small" aria-label="Close file picker" onClick={onClose}><X size={16}/></button>
      </header>
      <form className="pdf-picker-search" role="search" onSubmit={event => {
        event.preventDefault();
        if (!browsing && visible[0]) onChoose(visible[0]);
      }}>
        <Search size={16} aria-hidden="true"/>
        <input ref={search} type="search" value={query} aria-label={browsing ? 'Search this folder' : 'Search PDFs'}
          placeholder={browsing ? 'Search this folder' : 'Search by filename, course, or week'}
          onChange={event => setQuery(event.target.value)}/>
      </form>
      <nav className="pdf-picker-scopes" aria-label="PDF sources">
        {scopes.filter(option => option.id !== 'course' || currentCourseId).map(option =>
          <button key={option.id} type="button" className="btn secondary small" aria-pressed={scope === option.id}
            onClick={() => { setScope(option.id); setBrowseFolders(false); }}>
            {option.id === 'drive' && <HardDrive size={14} aria-hidden="true"/>}{option.label}
          </button>)}
      </nav>
      {scope === 'drive' && driveConnected && <button type="button" className="btn secondary small pdf-picker-folder-toggle"
        onClick={() => { setQuery(''); setBrowseFolders(value => !value); }}>
        {browsing ? <ArrowLeft size={15} aria-hidden="true"/> : <Folder size={15} aria-hidden="true"/>}
        {browsing ? 'Back to PDF list' : 'Browse Drive folders'}
      </button>}
      {browsing ? <DrivePdfBrowser user={user} query={query} onOpen={openDriveFile}/> :
        <div className="pdf-picker-results">
          {visible.map(choice => <button type="button" className="pdf-picker-result" key={choice.id} title={choice.title}
            onClick={() => onChoose(choice)}>
            {choice.openKey ? <BookOpen size={17} aria-hidden="true"/> : <FileText size={17} aria-hidden="true"/>}
            <span><strong>{choice.title}</strong><small>{choice.location}</small></span>
            {choice.openKey && <small className="pdf-picker-open">Open tab</small>}
            {choice.fileId ? <ChevronRight size={15} aria-hidden="true"/> : <ArrowUpRight size={15} aria-label="Opens in browser"/>}
          </button>)}
          {scope !== 'course' && driveLoading && <p role="status">Loading Drive PDFs…</p>}
          {scope !== 'course' && driveError && <p role="alert">Could not load Drive PDFs. <button type="button" className="text-button" onClick={onRetryDrive}>Retry</button></p>}
          {!visible.length && !driveLoading && <p role="status">{scope === 'drive' && !driveConnected && !driveError
            ? 'Connect Google Drive in Resources to browse your files.' : 'No PDFs match your search.'}</p>}
        </div>}
    </div>
  </dialog>;
}

function DrivePdfBrowser({ user, query, onOpen }: { user: User | null; query: string; onOpen: (file: DriveEntry) => void }) {
  const [trail, setTrail] = useState([{ id: 'root', name: 'My Drive' }]);
  const folder = trail[trail.length - 1];
  const [loadedFolder, setLoadedFolder] = useState('');
  const [files, setFiles] = useState<DriveEntry[]>([]);
  const [nextPage, setNextPage] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const load = useCallback((pageToken?: string) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ folder_id: folder.id });
    if (pageToken) params.set('page_token', pageToken);
    void api<DriveList>(`/api/drive/files?${params}`, user, { signal: controller.signal, timeoutMs: 35000 })
      .then(result => {
        if (controller.signal.aborted) return;
        setFiles(previous => pageToken ? [...previous, ...result.files] : result.files);
        setNextPage(result.nextPageToken);
        setLoadedFolder(folder.id);
      }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [folder.id, user]);

  useEffect(() => {
    load();
    return () => pending.current?.abort();
  }, [load]);

  const ready = loadedFolder === folder.id;
  const visible = ready ? files.filter(file => file.name.toLowerCase().includes(query.trim().toLowerCase())) : [];
  return <div className="pdf-picker-results">
    <nav className="pdf-picker-path" aria-label="Drive folder path">
      {trail.map((part, index) => <button type="button" className="text-button" key={part.id}
        aria-current={folder.id === part.id ? 'location' : undefined} onClick={() => setTrail(trail.slice(0, index + 1))}>{part.name}</button>)}
    </nav>
    {visible.map(file => {
      const isPdf = file.mimeType === 'application/pdf';
      return <button type="button" className="pdf-picker-result" key={file.id} onClick={() => {
        if (isPdf) onOpen(file);
        else setTrail([...trail, { id: file.id, name: file.name }]);
      }}>
        {isPdf ? <FileText size={17} aria-hidden="true"/> : <Folder size={17} aria-hidden="true"/>}
        <span><strong>{file.name}</strong><small>{isPdf ? 'PDF document' : 'Folder'}</small></span><ChevronRight size={15} aria-hidden="true"/>
      </button>;
    })}
    {loading && <p role="status">Loading Drive folder…</p>}
    {error && <p role="alert">Could not load this folder. <button type="button" className="text-button" onClick={() => load(ready ? nextPage : undefined)}>Retry</button></p>}
    {ready && !loading && !error && !visible.length && <p role="status">No matching PDFs or folders here.</p>}
    {ready && nextPage && !error && <button className="btn secondary small" type="button" disabled={loading} onClick={() => load(nextPage)}>Load more</button>}
  </div>;
}
