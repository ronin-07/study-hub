/** Recovery policy for the initial private workspace read. No user data is cached here. */
export type SnapshotLoadProblem = {
  title: string;
  description: string;
  diagnostics: string;
};

type HttpFailure = { status?: unknown; requestId?: unknown; message?: unknown; name?: unknown };
function responseStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as HttpFailure).status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

export function canRetrySnapshot(error: unknown): boolean {
  const status = responseStatus(error);
  if (status !== null) return [408, 429, 500, 502, 503, 504].includes(status);
  return error instanceof TypeError || (error instanceof Error && error.name === 'AbortError');
}

/** One bounded retry for transient cold starts or temporary network failures. */
export async function fetchSnapshotWithRetry<T>(
  request: () => Promise<T>,
  pause: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!canRetrySnapshot(error)) throw error;
    await pause(500);
    return request();
  }
}

export function describeSnapshotFailure(error: unknown): SnapshotLoadProblem {
  const status = responseStatus(error);
  const http = error && typeof error === 'object' ? (error as HttpFailure) : {};
  const requestId = typeof http.requestId === 'string' && /^[\w.-]{1,120}$/.test(http.requestId)
    ? ` · Request ${http.requestId}` : '';
  const diagnostics = status !== null ? `Snapshot API: HTTP ${status}${requestId}`
    : error instanceof Error ? `Snapshot API: ${error.name === 'AbortError' ? 'Request timed out' : 'Network or response error'}`
      : 'Snapshot API: Unknown error';
  if (status === 401) return {title: 'Your sign-in needs refreshing', description: 'The API did not accept the current Firebase session. Try signing out and signing in again.', diagnostics};
  if (status === 403) return {title: 'This account cannot access Study Hub', description: 'Check that the Preview deployment allows your signed-in Google account. Production and Preview must remain isolated.', diagnostics};
  if (status === 404) return {title: 'Study Hub API route is missing', description: 'The /api/snapshot endpoint was not found. Check the Vercel Services routing and the deployed backend service.', diagnostics};
  if (status !== null && status >= 500) return {title: 'Study Hub service is temporarily unavailable', description: 'The application could not read your workspace. Check the Preview API deployment logs and Firebase configuration; your data has not been replaced.', diagnostics};
  if (status === 429) return {title: 'Too many requests', description: 'Study Hub is temporarily rate-limited. Retry once the service is ready.', diagnostics};
  if (status !== null) return {title: 'Study Hub could not load your workspace', description: 'The API rejected the request. Please check the diagnostic status before retrying.', diagnostics};
  if (error instanceof Error && error.name === 'AbortError') return {title: 'Study Hub is taking too long to respond', description: 'The API request timed out. Retry or check whether the Preview backend is running.', diagnostics};
  if (error instanceof TypeError) return {title: 'Could not reach the Study Hub API', description: 'Check your connection and the Preview deployment. If the page loads but data does not, the backend service may be unavailable.', diagnostics};
  return {title: 'Study Hub returned an unexpected response', description: 'The app could not interpret the workspace data. Check the browser console and Preview backend logs.', diagnostics};
}
