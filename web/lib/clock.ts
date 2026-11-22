/** Local date and 24-hour clock, matching the local dates used for Study Hub tasks. */
const dateFormatter = new Intl.DateTimeFormat('en-DK', {month: 'short', day: 'numeric', year: 'numeric'});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

export function formatLocalDate(epochMs: number): string {
  return dateFormatter.format(new Date(epochMs));
}

export function formatLocalClock(epochMs: number): string {
  return timeFormatter.format(new Date(epochMs));
}
