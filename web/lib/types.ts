export type Kind = 'lecture' | 'notes' | 'reading' | 'revision' | 'assignment' | 'personal';
export type Priority = 'low' | 'medium' | 'high';
export type Semester = { id: string; name: string; start_date: string | null; end_date: string | null };
export type Course = { id: string; code: string; title: string; semester: string; semester_id?: string | null; week_count: number; exam_date?: string | null; goals?: string; archived?: boolean };
export type Week = { id: string; course_id: string; number: number; title: string; objectives: string };
export type Item = { id: string; title: string; kind: Kind; course_id: string | null; week_number: number | null; is_task: boolean; done: boolean; submitted: boolean; planned_date: string | null; due_date: string | null; priority: Priority; repeat?: 'none'|'daily'|'weekly'|'monthly'; repeat_series_id?: string | null; notes: string; chapter?: string; page_start?: number | null; page_end?: number | null; resource_id?: string | null };
export type Resource = { id: string; course_id: string; week_number: number | null; title: string; kind: 'slides' | 'annotated' | 'handwritten' | 'textbook' | 'other'; source: 'drive' | 'dtu' | 'link'; url: string | null; drive_file_id: string | null; item_id: string | null; last_page: number; chapter?: string; page_start?: number | null; page_end?: number | null };
export type FocusSession = { id: string; course_id: string | null; item_id: string | null; week_number: number | null; mode: '25' | '50' | '90' | 'free'; status: 'running' | 'paused' | 'finished'; started_at: number; pause_started_at: number | null; accumulated_pause_seconds: number; ended_at: number | null; focus_seconds: number | null };
export type Snapshot = { courses: Course[]; weeks: Week[]; items: Item[]; resources: Resource[]; sessions: FocusSession[]; semesters: Semester[] };
export type DriveEntry = { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; webViewLink?: string };
export type DriveList = { files: DriveEntry[]; nextPageToken?: string };
export type DriveSource = { id: string; folder_id: string; name: string; scanned_at: number | null };
export type DriveSuggestion = {
  course_id: string; course_code: string; week_number: number; week_title: string | null;
  kind: Resource['kind']; confidence: 'high' | 'low'; reason: string;
};
export type DriveIndexed = DriveEntry & {
  path: string; suggestion: DriveSuggestion | null;
  links: { resource_id: string; course_id: string; week_number: number | null }[];
};
export type DriveIndexResponse = { folder: DriveSource | null; files: DriveIndexed[] };
export type DriveScanResponse = { count: number; scanned_at: number; files: DriveIndexed[] };
export type Tab = 'today' | 'courses' | 'tasks' | 'focus' | 'library';
export const kindLabels: Record<Kind,string> = { lecture: 'Lecture', notes: 'Notes', reading: 'Reading', revision: 'Revision', assignment: 'Assignment', personal: 'Personal' };
export function formatDate(value?: string | null) { if (!value) return 'Not set'; const [y,m,d] = value.split('-'); return `${d}/${m}/${y}`; }
export function localToday() { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); }
export function elapsedFocus(s: FocusSession, now: number) { const stop = s.ended_at ?? now; const paused = s.accumulated_pause_seconds + (s.status==='paused' && s.pause_started_at ? Math.max(0,stop-s.pause_started_at) : 0); return Math.max(0,stop-s.started_at-paused); }
export function duration(sec: number) { return `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor(sec%3600/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`; }
