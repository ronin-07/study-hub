import type { StudyPdf } from './pdf-study';
import type { Course, DriveIndexed, Resource } from './types';

export type PdfChoice = {
  id: string;
  title: string;
  location: string;
  courseId?: string;
  fileId?: string;
  resource?: Resource;
  openKey?: string;
  search: string;
};
export type PdfLibraryScope = 'all' | 'course' | 'drive';

function directPdf(url: string | null) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

export function pdfLibraryChoices(
  resources: Resource[], courses: Course[], indexed: DriveIndexed[], tabs: StudyPdf[], currentCourseId?: string,
): PdfChoice[] {
  const choices: PdfChoice[] = [];
  const courseById = new Map(courses.map(course => [course.id, course]));
  const knownFiles = new Set<string>();
  for (const resource of resources) {
    const fileId = resource.source === 'drive' ? resource.drive_file_id ?? undefined : undefined;
    if (!fileId && !directPdf(resource.url)) continue;
    const course = courseById.get(resource.course_id);
    const section = resource.kind === 'exam_paper' || resource.kind === 'exam_solution' ? 'Exam prep' :
      resource.week_number == null ? 'Course library' : `Week ${resource.week_number}`;
    const location = [course?.code, section].filter(Boolean).join(' · ');
    const openKey = (tabs.find(tab => tab.resourceId === resource.id)
      ?? tabs.find(tab => !tab.resourceId && tab.fileId === fileId))?.key;
    choices.push({
      id: `resource:${resource.id}`, title: resource.exam_display_name || resource.title, location,
      courseId: resource.course_id, fileId, resource, openKey,
      search: [resource.title, resource.exam_display_name, course?.title, location].filter(Boolean).join(' '),
    });
    if (fileId) knownFiles.add(fileId);
  }
  for (const file of indexed) {
    if (knownFiles.has(file.id)) continue;
    const location = file.path ? `Google Drive · ${file.path}` : 'Google Drive';
    choices.push({ id: `drive:${file.id}`, title: file.name, fileId: file.id, location,
      openKey: tabs.find(tab => tab.fileId === file.id)?.key, search: `${file.name} ${location}` });
    knownFiles.add(file.id);
  }
  const represented = new Set(choices.flatMap(choice => choice.openKey ? [choice.openKey] : []));
  for (const tab of tabs) {
    if (represented.has(tab.key)) continue;
    choices.push({ id: `tab:${tab.key}`, title: tab.title, fileId: tab.fileId, location: 'Google Drive',
      courseId: tab.courseId, openKey: tab.key, search: tab.title });
  }
  return choices.sort((a, b) => Number(b.courseId === currentCourseId && !!currentCourseId)
    - Number(a.courseId === currentCourseId && !!currentCourseId) || a.title.localeCompare(b.title, undefined, { numeric: true }));
}

export function filterPdfChoices(choices: PdfChoice[], scope: PdfLibraryScope, query: string, currentCourseId?: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return choices.filter(choice => (scope === 'all'
    || (scope === 'drive' && !!choice.fileId)
    || (scope === 'course' && !!currentCourseId && choice.courseId === currentCourseId))
    && terms.every(term => choice.search.toLowerCase().includes(term)));
}
