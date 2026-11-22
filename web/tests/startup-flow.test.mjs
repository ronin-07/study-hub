import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
test('initial auth resolution never marks the page as failed before fetching',()=>{
 assert.match(page,/if \(!authReady\) return false;/);
 assert.match(page,/const hadSnapshot=loadedUserRef\.current===uid;/);
 assert.match(page,/if \(!hadSnapshot\) \{/);
 assert.match(page,/setLoading\(true\);/);
 assert.match(page,/loadedUserRef\.current!==\(user\?\.uid\|\|'local'\)/);
});
test('failed background refresh does not replace last valid dashboard',()=>{
 assert.match(page,/if \(hadSnapshot\) setError\(/);
 assert.match(page,/setSnapshotIssue\(issue\)/);
 assert.match(page,/loadRequestRef/);
});
test('initial load diagnostic is visible and does not expose raw API response',()=>{
 assert.match(page,/snapshotIssue.diagnostics/);
 assert.match(page,/Technical details for troubleshooting/);
 assert.match(page,/Retry loading/);
});
