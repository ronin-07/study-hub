import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFocusDuration, focusDurationParts, setFocusDurationPart } from '../lib/focus-display.ts';

test('Focus displays seconds without false zero-hour rounding',()=>{
  assert.equal(formatFocusDuration(0),'0 sec');
  assert.equal(formatFocusDuration(16),'16 sec');
  assert.equal(formatFocusDuration(480),'8 min');
  assert.equal(formatFocusDuration(3120),'52 min');
  assert.equal(formatFocusDuration(5100),'1h 25m');
});
test('review duration fields preserve exact seconds and never exceed original limit',()=>{
  assert.deepEqual(focusDurationParts(3661),{hours:1,minutes:1,seconds:1});
  assert.equal(setFocusDurationPart(3661,'minutes','45',7200),6301);
  assert.equal(setFocusDurationPart(3661,'hours','4',4000),4000);
  assert.equal(setFocusDurationPart(9,'seconds','99',9),9);
});
