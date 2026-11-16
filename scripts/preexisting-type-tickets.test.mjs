// Tests for preexisting-type-tickets.mjs (#3249) — run: node --test scripts/preexisting-type-tickets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scopeLabel, ticketBody, ticketTitle, planTickets } from './preexisting-type-tickets.mjs';
import { classifyTypeErrors, groupPreexisting } from './pi-finish.mjs';

// The real #3245 hold, run through the real classifier → the group the finish step writes.
const REAL_3245 = "##[error]server/api/status/signin-link.post.ts(26,36): error TS2551: Property 'signInMagicLink' does not exist on type 'X'. Did you mean 'signInEmail'?";
const realGroups = () => {
  const r = classifyTypeErrors({
    logText: REAL_3245, tcExit: 2, appDir: 'pocs/status',
    committedFiles: ['pocs/status/server/utils/live-apps-core.ts'],
  });
  return groupPreexisting(r.notInDiff, { maxTickets: Infinity }).toOpen;
};
const group = (file, code = 'TS2322') => ({ file, code, count: 1, errors: [{ file, line: 1, col: 1, code, text: 'bad' }], marker: `<!-- preexisting-type-error:${file}:${code} -->` });

test('scopeLabel: pocs/ → poc:, apps/ → app:, anything else → null', () => {
  assert.equal(scopeLabel('pocs/status'), 'poc:status');
  assert.equal(scopeLabel('apps/velo'), 'app:velo');
  assert.equal(scopeLabel('scripts'), null);
  assert.equal(scopeLabel('fixtures/minimal'), null);
  assert.equal(scopeLabel(''), null);
});

test('ticketBody: contains the PR url and the error line, and ends with the marker', () => {
  const [g] = realGroups();
  const body = ticketBody({ group: g, prUrl: 'https://github.com/o/r/pull/3245', appDir: 'pocs/status' });
  assert.match(body, /## 👤 For humans/);
  assert.match(body, /Found by: https:\/\/github\.com\/o\/r\/pull\/3245/);
  assert.match(body, /signin-link\.post\.ts\(26,36\): TS2551 Property 'signInMagicLink'/);
  assert.ok(body.trimEnd().endsWith('<!-- preexisting-type-error:pocs/status/server/api/status/signin-link.post.ts:TS2551 -->'));
  assert.match(ticketTitle(g), /TS2551 in pocs\/status\/server\/api\/status\/signin-link\.post\.ts/);
});

test('ticketBody: lists at most 10 error lines', () => {
  const g = group('apps/x/a.ts');
  g.errors = Array.from({ length: 14 }, (_, i) => ({ file: g.file, line: i + 1, col: 1, code: g.code, text: 'bad' }));
  g.count = 14;
  const body = ticketBody({ group: g, prUrl: 'u' });
  assert.equal(body.split('\n').filter((l) => l.startsWith('apps/x/a.ts(')).length, 10);
  assert.match(body, /…and 4 more/);
});

test('planTickets: comments on an open issue carrying the marker', () => {
  const [g] = realGroups();
  const plan = planTickets({ groups: [g], openIssues: [{ number: 77, body: `old ticket\n${g.marker}` }], prNumber: 3245 });
  assert.deepEqual(plan.comment.map((c) => c.issue), [77]);
  assert.equal(plan.open.length, 0);
});

test('planTickets: skips a match whose body already links this PR (an earlier revision)', () => {
  const [g] = realGroups();
  const plan = planTickets({ groups: [g], openIssues: [{ number: 77, body: `Found by: https://github.com/o/r/pull/3245\n${g.marker}` }], prNumber: 3245 });
  assert.equal(plan.comment.length, 0);
  assert.equal(plan.open.length, 0);
  assert.equal(plan.rest.length, 0);
});

test('planTickets: opens at most 3 new tickets and lists the rest', () => {
  const groups = ['a', 'b', 'c', 'd', 'e'].map((n) => group(`apps/x/${n}.ts`));
  const plan = planTickets({ groups, openIssues: [{ number: 9, body: groups[4].marker }], prNumber: 1 });
  assert.deepEqual(plan.open.map((g) => g.file), ['apps/x/a.ts', 'apps/x/b.ts', 'apps/x/c.ts']);
  assert.deepEqual(plan.rest.map((g) => g.file), ['apps/x/d.ts']);
  assert.deepEqual(plan.comment.map((c) => c.issue), [9]);
});

test('CLI: always exits 0 and prints a LINE, even when gh is unavailable or the groups file is missing', () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'preexisting-type-tickets.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-tt-'));
  const groupsPath = path.join(dir, 'groups.json');
  fs.writeFileSync(groupsPath, JSON.stringify(realGroups()));
  // An empty PATH means `gh` cannot be found: every side effect fails, the line still prints.
  const env = { ...process.env, PATH: '' };
  const r = spawnSync(process.execPath, [script, '--groups', groupsPath, '--pr', '3245', '--app', 'pocs/status'], { encoding: 'utf8', env });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^LINE=acceptance: pass — 1 error\(s\) in files this PR didn't touch$/m);
  const missing = spawnSync(process.execPath, [script, '--groups', path.join(dir, 'nope.json'), '--pr', '1'], { encoding: 'utf8', env });
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /^LINE=acceptance: pass — 0 error\(s\)/m);
  fs.rmSync(dir, { recursive: true, force: true });
});
