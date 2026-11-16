// Unit tests for the pi finish step's decision logic (#1893) — a pure-ish port so the shell↔script
// boundary defects from #1876 can be caught locally instead of only in production.
//   node --test scripts/pi-finish.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolveSession, planAcceptance, planTestsGate, verdict,
  parseTsErrors, classifyTypeErrors, groupPreexisting, formatAcceptanceLine,
} from './pi-finish.mjs';

test('resolveSession: returns null (not throw) on a missing/empty session dir — the #1876 SESSION bug', () => {
  assert.equal(resolveSession('/nonexistent/dir/for/sure'), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-fin-'));
  assert.equal(resolveSession(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveSession: returns the newest *.jsonl in the dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-fin-'));
  const older = path.join(dir, 'a.jsonl');
  const newer = path.join(dir, 'b.jsonl');
  fs.writeFileSync(older, '{}');
  fs.writeFileSync(newer, '{}');
  const now = Date.now() / 1000;
  fs.utimesSync(older, now - 10, now - 10);
  fs.utimesSync(newer, now, now);
  assert.equal(resolveSession(dir), newer);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('planAcceptance: a packages/-only file list yields appDir null and does not throw — the #1876 APP_DIR bug', () => {
  const result = planAcceptance({ committedFiles: ['packages/crouton-core/util.ts', 'packages/crouton-core/util.test.ts'] });
  assert.equal(result.appDir, null);
});

test('planAcceptance: an apps/ path yields the app dir', () => {
  const result = planAcceptance({ committedFiles: ['apps/velo/app/pages/index.vue', 'apps/velo/package.json'] });
  assert.equal(result.appDir, 'apps/velo');
});

test('planAcceptance: a pocs/ path yields the poc dir', () => {
  const result = planAcceptance({ committedFiles: ['pocs/lend/schemas/loans.json'] });
  assert.equal(result.appDir, 'pocs/lend');
});

test('planAcceptance: empty committed files yields appDir null', () => {
  assert.equal(planAcceptance({ committedFiles: [] }).appDir, null);
});

test('planTestsGate: a 3-file bucket round-trips 3 files — reported count equals staged count (#1876)', () => {
  const files = ['packages/x/a.ts', 'packages/x/b.ts', 'packages/x/c.ts'];
  const result = planTestsGate({ committedFiles: files });
  assert.equal(result.pkgLogic.length, 3);
  assert.equal(result.missing, true);
});

test('planTestsGate: .vue-only changes are not gated (UI gate territory, not this one)', () => {
  const result = planTestsGate({ committedFiles: ['packages/crouton-core/app/components/Foo.vue'] });
  assert.equal(result.missing, false);
});

test('planTestsGate: locale JSON-only changes are not gated (#1874 must not be held)', () => {
  const result = planTestsGate({ committedFiles: ['packages/crouton-i18n/locales/nl.json'] });
  assert.equal(result.missing, false);
});

test('planTestsGate: pocs/ changes are not gated (test-first is off for pocs)', () => {
  const result = planTestsGate({ committedFiles: ['pocs/lend/server/api/loans.get.ts'] });
  assert.equal(result.missing, false);
});

test('planTestsGate: logic with an accompanying test is not gated', () => {
  const result = planTestsGate({ committedFiles: ['packages/x/util.ts', 'packages/x/util.test.ts'] });
  assert.equal(result.missing, false);
  assert.equal(result.testFiles.length, 1);
});

test('planTestsGate: no packages/ logic at all is not gated', () => {
  const result = planTestsGate({ committedFiles: ['docs/content/guide.md', 'scripts/other.mjs'] });
  assert.equal(result.missing, false);
  assert.equal(result.pkgLogic.length, 0);
});

test('verdict: draft on a failed acceptance', () => {
  const v = verdict({ acceptance: 'fail', testsMissing: false });
  assert.equal(v.draft, true);
});

test('verdict: draft when tests are missing', () => {
  const v = verdict({ acceptance: 'pass', testsMissing: true });
  assert.equal(v.draft, true);
});

test('verdict: not draft on a clean pass with no missing tests', () => {
  const v = verdict({ acceptance: 'pass', testsMissing: false });
  assert.equal(v.draft, false);
});

test('verdict: neutral acceptance with no missing tests is not draft', () => {
  const v = verdict({ acceptance: 'neutral', testsMissing: false });
  assert.equal(v.draft, false);
});

test('planTestsGate: a revision commit with no test, on a PR that already has one, is NOT missing (#3411)', () => {
  const r = planTestsGate({ committedFiles: ['packages/x/util.ts'], prFiles: ['packages/x/util.ts', 'packages/x/util.test.ts'] });
  assert.equal(r.missing, false);
});

test('planTestsGate: a PR with no test anywhere is still missing, and names the file (#3411)', () => {
  const r = planTestsGate({ committedFiles: ['packages/x/util.ts'], prFiles: ['packages/x/util.ts', 'docs/a.md'] });
  assert.equal(r.missing, true);
  assert.deepEqual(r.pkgLogic, ['packages/x/util.ts']);
});

test('planTestsGate: no prFiles behaves exactly as before (#3411)', () => {
  assert.equal(planTestsGate({ committedFiles: ['packages/x/util.ts'] }).missing, true);
  assert.equal(planTestsGate({ committedFiles: ['packages/x/util.ts'], prFiles: [] }).missing, true);
});

test('planTestsGate: logic files from earlier commits count too (#3411)', () => {
  const r = planTestsGate({ committedFiles: ['packages/x/b.ts', 'packages/x/b.test.ts'], prFiles: ['packages/x/a.ts'] });
  assert.equal(r.missing, false);
  assert.deepEqual(r.pkgLogic.sort(), ['packages/x/a.ts', 'packages/x/b.ts']);
});

test('CLI plan: optional pr-files argument; missing path exits 0 (#3411)', () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pi-finish.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-fin-'));
  const committed = path.join(dir, 'c.txt');
  const pr = path.join(dir, 'p.txt');
  fs.writeFileSync(committed, 'packages/x/util.ts\n');
  fs.writeFileSync(pr, 'packages/x/util.ts\npackages/x/util.test.ts\n');
  const missing = spawnSync('node', [script, 'plan', committed, path.join(dir, 'nope.txt')], { encoding: 'utf8' });
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /TESTS_MISSING=1/);
  assert.match(missing.stdout, /PKG_LOGIC_FILES=packages\/x\/util\.ts/);
  const ok = spawnSync('node', [script, 'plan', committed, pr], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /TESTS_MISSING=0/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── #3248: type errors split into in-diff vs pre-existing ──────────────────────────────────────────────────

// The real log line from worker run 41608928107 (#3224 / #3245).
const REAL_3245 = "##[error]server/api/status/signin-link.post.ts(26,36): error TS2551: Property 'signInMagicLink' does not exist on type 'X'. Did you mean 'signInEmail'?";
const REAL_3245_COMMITTED = [
  'pocs/status/server/routes/login/[app].get.ts',
  'pocs/status/server/utils/live-apps-core.ts',
  'pocs/status/server/utils/live-apps-core.test.ts',
];

test('classifyTypeErrors: app-relative log path matches a repo-root diff path → fail (the rule guard)', () => {
  const r = classifyTypeErrors({
    logText: 'server/x.ts(1,1): error TS2322: Type string is not assignable to number.',
    tcExit: 2, committedFiles: ['pocs/status/server/x.ts'], appDir: 'pocs/status',
  });
  assert.equal(r.acceptance, 'fail');
  assert.equal(r.inDiff.length, 1);
  assert.equal(r.inDiff[0].file, 'pocs/status/server/x.ts');
});

test('classifyTypeErrors: the real #3245 hold — an error in an untouched file passes with one group to ticket', () => {
  const r = classifyTypeErrors({
    logText: `> nuxi typecheck\n${REAL_3245}\n`, tcExit: 2,
    committedFiles: REAL_3245_COMMITTED, prFiles: REAL_3245_COMMITTED, appDir: 'pocs/status',
  });
  assert.equal(r.acceptance, 'pass');
  assert.equal(r.inDiff.length, 0);
  const { toOpen, rest } = groupPreexisting(r.notInDiff);
  assert.equal(toOpen.length, 1);
  assert.equal(rest.length, 0);
  assert.equal(toOpen[0].marker, '<!-- preexisting-type-error:pocs/status/server/api/status/signin-link.post.ts:TS2551 -->');
  assert.equal(toOpen[0].errors[0].line, 26);
  assert.equal(toOpen[0].errors[0].col, 36);
});

test('classifyTypeErrors: one in-diff and one not-in-diff error → fail', () => {
  const r = classifyTypeErrors({
    logText: 'server/a.ts(1,1): error TS2322: x\nserver/b.ts(2,2): error TS2551: y',
    tcExit: 2, committedFiles: ['pocs/status/server/a.ts'], appDir: 'pocs/status',
  });
  assert.equal(r.acceptance, 'fail');
  assert.equal(r.inDiff.length, 1);
  assert.equal(r.notInDiff.length, 1);
});

test('classifyTypeErrors: never false-pass a typecheck that did not run (#1849)', () => {
  const base = { committedFiles: ['pocs/status/server/a.ts'], appDir: 'pocs/status' };
  assert.equal(classifyTypeErrors({ ...base, logText: '', tcExit: 1 }).acceptance, 'neutral');
  assert.equal(classifyTypeErrors({ ...base, logText: '', tcExit: 0 }).acceptance, 'pass');
  const outside = classifyTypeErrors({ ...base, logText: '../../packages/x/a.ts(1,1): error TS2322: x', tcExit: 2 });
  assert.equal(outside.acceptance, 'pass');
  assert.equal(outside.notInDiff.length, 0);
});

test('classifyTypeErrors: a typecheck that never ran is never a pass — TS18003 No inputs were found → neutral', () => {
  const r = classifyTypeErrors({
    logText: "error TS18003: No inputs were found in config file '/repo/pocs/status/tsconfig.json'. Specified 'include' paths were '[\"**/*\"]'.",
    tcExit: 2, committedFiles: ['pocs/status/server/a.ts'], appDir: 'pocs/status',
  });
  assert.equal(r.acceptance, 'neutral');
  assert.match(r.message, /not verified/);
});

test('classifyTypeErrors: a typecheck that never ran is never a pass — TS5083 Cannot read file → neutral', () => {
  const r = classifyTypeErrors({
    logText: "##[error]error TS5083: Cannot read file '/repo/pocs/status/.nuxt/tsconfig.json'.",
    tcExit: 2, committedFiles: ['pocs/status/server/a.ts'], appDir: 'pocs/status',
  });
  assert.equal(r.acceptance, 'neutral');
  // …and still not a pass when a readable error elsewhere sits next to it.
  const mixed = classifyTypeErrors({
    logText: "error TS5083: Cannot read file '/x/tsconfig.json'.\nserver/b.ts(2,2): error TS2551: y",
    tcExit: 2, committedFiles: ['pocs/status/server/a.ts'], appDir: 'pocs/status',
  });
  assert.equal(mixed.acceptance, 'neutral');
});

test('classifyTypeErrors: a CRLF line (trailing \\r) is still read — an in-diff error fails, never passes', () => {
  const r = classifyTypeErrors({
    logText: 'server/a.ts(1,1): error TS2322: Type string is not assignable to number.\r\n',
    tcExit: 2, committedFiles: ['pocs/status/server/a.ts'], appDir: 'pocs/status',
  });
  assert.equal(r.acceptance, 'fail');
  assert.equal(r.inDiff.length, 1);
  assert.equal(r.inDiff[0].text, 'Type string is not assignable to number.');
});

test('classifyTypeErrors: TS2304 Cannot find name (auto-imports unresolved) stays neutral even with an in-diff error', () => {
  const r = classifyTypeErrors({
    logText: "server/a.ts(1,1): error TS2322: x\nserver/c.ts(3,3): error TS2304: Cannot find name 'useFoo'.",
    tcExit: 2, committedFiles: ['pocs/status/server/a.ts'], appDir: 'pocs/status',
  });
  assert.equal(r.acceptance, 'neutral');
});

test('classifyTypeErrors: a package-only PR (borrowed app) passes on errors in untouched app files', () => {
  const pkg = ['packages/crouton-core/src/a.ts'];
  const r = classifyTypeErrors({
    logText: 'server/x.ts(1,1): error TS2322: x', tcExit: 2,
    committedFiles: pkg, prFiles: pkg, appDir: 'pocs/status',
  });
  assert.equal(r.acceptance, 'pass');
  assert.deepEqual(r.notInDiff.map((e) => e.file), ['pocs/status/server/x.ts']);
});

test('classifyTypeErrors: a fix round is judged over the whole PR (prFiles), not just this run', () => {
  const input = {
    logText: 'server/a.ts(1,1): error TS2322: x', tcExit: 2,
    committedFiles: ['pocs/status/server/b.ts'], appDir: 'pocs/status',
  };
  assert.equal(classifyTypeErrors({ ...input, prFiles: ['pocs/status/server/a.ts', 'pocs/status/server/b.ts'] }).acceptance, 'fail');
  assert.equal(classifyTypeErrors({ ...input, prFiles: [] }).acceptance, 'pass');
});

test('groupPreexisting: groups by file + code; caps toOpen at 3 with a stable order', () => {
  const e = (file, code) => ({ file, code, line: 1, col: 1, text: 't' });
  const same = groupPreexisting([e('a.ts', 'TS1'), e('a.ts', 'TS1')]);
  assert.equal(same.toOpen.length, 1);
  assert.equal(same.toOpen[0].count, 2);
  const five = [e('e.ts', 'TS1'), e('d.ts', 'TS1'), e('c.ts', 'TS1'), e('b.ts', 'TS1'), e('a.ts', 'TS2'), e('a.ts', 'TS1'), e('c.ts', 'TS1')];
  const r = groupPreexisting(five);
  assert.deepEqual(r.toOpen.map((g) => `${g.file}:${g.code}`), ['c.ts:TS1', 'a.ts:TS1', 'a.ts:TS2']);
  assert.deepEqual(r.rest.map((g) => `${g.file}:${g.code}`), ['b.ts:TS1', 'd.ts:TS1', 'e.ts:TS1']);
  const exactlyFive = groupPreexisting([e('a.ts', 'TS1'), e('b.ts', 'TS1'), e('c.ts', 'TS1'), e('d.ts', 'TS1'), e('e.ts', 'TS1')]);
  assert.equal(exactlyFive.toOpen.length, 3);
  assert.equal(exactlyFive.rest.length, 2);
});

test('parseTsErrors: reads both the (l,c): and :l:c - forms; skips ../ paths but counts them', () => {
  const log = [
    'server/a.ts(12,3): error TS2345: Argument bad.',
    'app/b.vue:7:9 - error TS2322: Type bad.',
    '../../packages/x/c.ts(1,1): error TS2322: outside.',
    'some unrelated line',
  ].join('\n');
  const { errors, anyCount } = parseTsErrors(log);
  assert.equal(anyCount, 3);
  assert.deepEqual(errors, [
    { file: 'server/a.ts', line: 12, col: 3, code: 'TS2345', text: 'Argument bad.' },
    { file: 'app/b.vue', line: 7, col: 9, code: 'TS2322', text: 'Type bad.' },
  ]);
});

test('parseTsErrors: keeps [ ] and ( ) in Nuxt route paths, strips a ##[error] prefix', () => {
  const log = [
    'server/routes/login/[app].get.ts(5,2): error TS2322: bad',
    '##[error]app/pages/(auth)/login.vue(3,1): error TS2345: bad',
    'app/pages/admin/[team]/sales.vue:4:2 - error TS2322: bad',
  ].join('\n');
  assert.deepEqual(parseTsErrors(log).errors.map((e) => e.file), [
    'server/routes/login/[app].get.ts',
    'app/pages/(auth)/login.vue',
    'app/pages/admin/[team]/sales.vue',
  ]);
});

test('classifyTypeErrors: an error in a changed [bracket] or (group) route file fails', () => {
  const bracket = classifyTypeErrors({
    logText: 'server/routes/login/[app].get.ts(5,2): error TS2322: bad',
    tcExit: 1, committedFiles: ['pocs/status/server/routes/login/[app].get.ts'], appDir: 'pocs/status',
  });
  assert.equal(bracket.acceptance, 'fail');
  assert.equal(bracket.inDiff[0].file, 'pocs/status/server/routes/login/[app].get.ts');
  const group = classifyTypeErrors({
    logText: '##[error]app/pages/(auth)/login.vue(3,1): error TS2345: bad',
    tcExit: 1, prFiles: ['apps/kassa/app/pages/(auth)/login.vue'], appDir: 'apps/kassa',
  });
  assert.equal(group.acceptance, 'fail');
});

test('formatAcceptanceLine: exact run-record string, with and without tickets, plus the not-ticketed suffix', () => {
  assert.equal(formatAcceptanceLine({ count: 2, issueNumbers: [12, 34] }), "acceptance: pass — 2 error(s) in files this PR didn't touch → #12, #34");
  assert.equal(formatAcceptanceLine({ count: 1 }), "acceptance: pass — 1 error(s) in files this PR didn't touch");
  assert.equal(
    formatAcceptanceLine({ count: 5, issueNumbers: [1], rest: [{ file: 'a.ts', code: 'TS1' }, { file: 'b.ts', code: 'TS2' }] }),
    "acceptance: pass — 5 error(s) in files this PR didn't touch → #1; not ticketed: a.ts:TS1, b.ts:TS2",
  );
});
