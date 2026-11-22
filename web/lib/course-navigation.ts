/** Keep a course deep-link in its actual semester, rather than defaulting to the first semester. */
export function resolveWorkspaceSemester(semesterKeys: string[], localKey: string, requestedCourseKey: string): string {
  if (requestedCourseKey && semesterKeys.includes(requestedCourseKey)) return requestedCourseKey;
  if (localKey && semesterKeys.includes(localKey)) return localKey;
  return semesterKeys[0] || '';
}
