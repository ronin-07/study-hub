export type Kind = 'lecture' | 'notes' | 'reading' | 'questions' | 'revision' | 'assignment' | 'exercise' | 'personal';
export type Priority = 'low' | 'medium' | 'high';
export type Semester = { id: string; name: string; start_date: string | null; end_date: string | null };
export type Course = { id: string; code: string; title: string; semester: string; semester_id?: string | null; week_count: number; exam_date?: string | null; exam_time?: string | null; exam_duration_minutes?: number | null; exam_location?: string; exam_format?: string; exam_aids?: string; goals?: string; archived?: boolean };
export type Week = { id: string; course_id: string; number: number; title: string; objectives: string };
export type Item = { id: string; title: string; kind: Kind; course_id: string | null; week_number: number | null; is_task: boolean; hidden_from_tasks?: boolean; done: boolean; completed_at?: number | null; submitted: boolean; planned_date: string | null; due_date: string | null; priority: Priority; repeat?: 'none'|'daily'|'weekly'|'monthly'; repeat_series_id?: string | null; notes: string; chapter?: string; page_start?: number | null; page_end?: number | null; resource_id?: string | null };
export type ExamAttempt = {id:string; date:string; minutes:number; score:number|null; notes:string};
export type Resource = { id: string; course_id: string; week_number: number | null; title: string; kind: 'slides' | 'annotated' | 'handwritten' | 'textbook' | 'exam_paper' | 'exam_solution' | 'other'; source: 'drive' | 'dtu' | 'link'; url: string | null; drive_file_id: string | null; item_id: string | null; exam_paper_id?: string | null; exam_display_name?: string | null; exam_year?: number | null; last_page: number; exam_attempts?: ExamAttempt[]; chapter?: string; page_start?: number | null; page_end?: number | null };
export type FocusMode = `${number}` | 'free';
export type FocusSession = { id: string; course_id: string | null; item_id: string | null; week_number: number | null; mode: FocusMode; status: 'running' | 'paused' | 'finished'; started_at: number; pause_started_at: number | null; accumulated_pause_seconds: number; ended_at: number | null; focus_seconds: number | null };
export type FocusStats = { id: 'state'; total_seconds: number; completed_sessions: number };
export type Snapshot = { courses: Course[]; weeks: Week[]; items: Item[]; resources: Resource[]; sessions: FocusSession[]; semesters: Semester[]; focus_stats?: FocusStats };
export type DriveEntry = { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; webViewLink?: string };
export type DriveList = { files: DriveEntry[]; nextPageToken?: string };
export type DriveSource = { id: string; folder_id: string; name: string; scanned_at: number | null };
export type DriveSuggestion = {
  course_id: string; course_code: string; week_number: number; week_title: string | null;
  kind: Resource['kind']; confidence: 'high' | 'low'; reason: string;
};
export type DriveIndexed = Omit<DriveEntry, 'mimeType'> & {
  path: string; suggestion: DriveSuggestion | null;
  links: { resource_id: string; course_id: string; week_number: number | null }[];
};
export type DriveIndexResponse = { folder: DriveSource | null; files: DriveIndexed[] };
export type DriveScanResponse = { count: number; scanned_at: number; files: DriveIndexed[] };
export type Tab = 'today' | 'courses' | 'tasks' | 'calendar' | 'focus' | 'library';
export const kindLabels: Record<Kind,string> = { lecture: 'Lecture', notes: 'Notes', reading: 'Reading', questions: 'Questions', revision: 'Revision', assignment: 'Assignment', exercise: 'Exercise', personal: 'Personal' };
/** Space reference lists for display without altering stored chapter/question identifiers. */
export function formatStudyReference(value: string): string {
  return value.split(',').map(part => part.trim()).filter(Boolean).join(', ');
}
export function formatDate(value?: string | null) { if (!value) return 'Not set'; const [y,m,d] = value.split('-'); return `${d}/${m}/${y}`; }
export function localToday() { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); }
export function elapsedFocus(s: FocusSession, now: number) { const stop = s.ended_at ?? now; const paused = s.accumulated_pause_seconds + (s.status==='paused' && s.pause_started_at ? Math.max(0,stop-s.pause_started_at) : 0); return Math.max(0,stop-s.started_at-paused); }
export function duration(sec: number) { return `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor(sec%3600/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`; }
