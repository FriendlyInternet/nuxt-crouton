// Unit tests for the pi finish step's decision logic (#1893) — a pure-ish port so the shell↔script
// boundary defects from #1876 can be caught locally instead of only in production.
//   node --test scripts/pi-finish.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSession, planAcceptance, planTestsGate, verdict } from './pi-finish.mjs';

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
