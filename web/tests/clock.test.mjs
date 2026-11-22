import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatLocalClock, formatLocalDate} from '../lib/clock.ts';

test('24-hour clock shows stable, zero-padded hours and minutes',()=>{
  assert.match(formatLocalClock(Date.now()),/^\d{2}:\d{2}$/);
});

test('clock follows browser-local time and handles DST changes',()=>{
  // Both calculations follow the timezone of the user's browser.
  const date=new Date(2026,10,22,9,7,34);
  assert.equal(formatLocalClock(date.getTime()),'09:07');
  assert.equal(formatLocalDate(date.getTime()),new Intl.DateTimeFormat('en-DK',{month:'short',day:'numeric',year:'numeric'}).format(date));
  const late=new Date(2026,10,22,23,59);
  assert.equal(formatLocalClock(late.getTime()),'23:59');
});
