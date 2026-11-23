/** Presentation only: stored Focus durations remain exact integer seconds. */
export function formatFocusDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (value < 60) return `${value} sec`;
  if (value < 3600) return `${Math.floor(value / 60)} min${value % 60 ? ` ${value % 60}s` : ''}`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
}

export function focusDurationParts(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return { hours: Math.floor(value / 3600), minutes: Math.floor((value % 3600) / 60), seconds: value % 60 };
}

export function setFocusDurationPart(total: number, part: 'hours'|'minutes'|'seconds', raw: string, maximum: number): number {
  const value = Math.max(0, Math.floor(Number(raw) || 0));
  const current = focusDurationParts(total);
  const next = { ...current, [part]: part === 'hours' ? Math.min(24, value) : Math.min(59, value) };
  return Math.min(Math.max(0, maximum), next.hours * 3600 + next.minutes * 60 + next.seconds);
}
