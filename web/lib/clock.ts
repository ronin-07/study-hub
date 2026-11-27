/** Local date and 24-hour clock, matching the local dates used for Study Hub tasks. */
const dateFormatter = new Intl.DateTimeFormat('en-DK', {month: 'short', day: 'numeric', year: 'numeric'});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

export function formatLocalDate(epochMs: number): string {
  return dateFormatter.format(new Date(epochMs));
}

export function formatLocalClock(epochMs: number): string {
  return timeFormatter.format(new Date(epochMs));
}

/** Selecting either part of an optional time initializes the other part to 00. */
export function changeClockPart(value:string,part:'hour'|'minute',next:string):string {
  if(!next)return '';
  const [hour,minute]=/^([01]\d|2[0-3]):[0-5]\d$/.test(value)?value.split(':'):['00','00'];
  if(!(part==='hour'?/^(?:[01]\d|2[0-3])$/:/^[0-5]\d$/).test(next))return value;
  return part==='hour'?`${next}:${minute}`:`${hour}:${next}`;
}
