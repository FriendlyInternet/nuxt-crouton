/**
 * Canary rig assertions (#1878).
 *
 * The rig exists because the pipeline could only be tested by spending a real ticket. These cases
 * pin the assertions themselves — because a canary suite that silently stops checking is worse
 * than no suite: it reports green while the thing it guards rots (the #1612 skipped-test lesson,
 * and the #1876 "reported 3, committed 2" lesson in one).
 *
 * Every case is built from a REAL observed shape from this week's runs, so the rig is calibrated
 * against known-good and known-bad pipeline behaviour rather than invented data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCanary, checkAll, renderReport, ASSERTIONS } from './canary.mjs';

// The #1874 run AFTER the #1879 fix: 3 locale files, PR opened, not draft.
const HEALTHY = {
  pr: {
    number: 1881,
    draft: false,
    changedFiles: [
      'packages/crouton-sales/i18n/locales/en.json',
      'packages/crouton-sales/i18n/locales/fr.json',
      'packages/crouton-sales/i18n/locales/nl.json'
    ]
  },
  runRecord: '**Committed 3 file(s)** … ⚠️ **acceptance: not verified**',
  issueComments: []
};

// The #1874 run BEFORE the fix: branch pushed, no PR, and the misdiagnosis comment.
const BROKEN_NO_PR = {
  pr: null,
  runRecord: '',
  issueComments: ['🔴 this run produced nothing: pi finished without opening a PR… the issue is likely underspecified']
};

// The #1875 run: code shipped, none of the five agreed tests (#1885).
const TESTLESS = {
  pr: {
    number: 1882,
    draft: true,
    changedFiles: [
      'packages/crouton-sales/app/components/EventWorkspace/OrdersTab.vue',
      'packages/crouton-sales/server/api/crouton-sales/teams/[id]/events/[eventId]/orders.get.ts'
    ]
  },
  runRecord: '**Committed 2 file(s)** … 🧪 **tests: MISSING** — 1 `packages/` logic file(s) landed with no test file.',
  issueComments: []
};

test('a healthy run passes the shape a working pipeline produces', () => {
  const spec = {
    id: 'packages-3-files',
    issue: 1874,
    expect: { prOpened: true, draft: false, changedFileCount: 3, filesInclude: ['nl.json'] }
  };
  assert.equal(checkCanary(spec, HEALTHY).ok, true);
});

test('#1876: the dropped-file bug is caught by the count', () => {
  // Reported 3, committed 2 — the exact regression. A count alone catches it.
  const dropped = { ...HEALTHY, pr: { ...HEALTHY.pr, changedFiles: HEALTHY.pr.changedFiles.slice(0, 2) } };
  const spec = { id: 'packages-3-files', issue: 1874, expect: { changedFileCount: 3 } };
  const r = checkCanary(spec, dropped);
  assert.equal(r.ok, false);
  assert.match(r.results[0].detail, /2 file/);
});

test('#1876: the named file that mattered is caught even when the count is right', () => {
  // The subtler shape: 3 files, but the wrong 3 — a count would pass, filesInclude must not.
  const wrongThree = {
    ...HEALTHY,
    pr: { ...HEALTHY.pr, changedFiles: ['a/en.json', 'a/fr.json', 'a/de.json'] }
  };
  const spec = { id: 'x', issue: 1874, expect: { changedFileCount: 3, filesInclude: ['nl.json'] } };
  const r = checkCanary(spec, wrongThree);
  assert.equal(r.ok, false);
  assert.equal(r.results.find((x) => x.key === 'changedFileCount').ok, true);
  assert.equal(r.results.find((x) => x.key === 'filesInclude').ok, false);
});

test('#1876: no PR at all fails, and the misdiagnosis is caught separately', () => {
  const spec = {
    id: 'packages-3-files',
    issue: 1874,
    expect: { prOpened: true, commentsExclude: 'likely underspecified' }
  };
  const r = checkCanary(spec, BROKEN_NO_PR);
  assert.equal(r.ok, false);
  // BOTH must fire: the missing PR and the lie about why. Catching only the first would let the
  // pipeline keep misdirecting the reader as long as it eventually produced something.
  assert.equal(r.results.every((x) => !x.ok), true);
});

test('#1885: a testless packages change must be held as a draft and say so', () => {
  const spec = {
    id: 'tests-required',
    issue: 1875,
    expect: { prOpened: true, draft: true, runRecordIncludes: 'tests: MISSING' }
  };
  assert.equal(checkCanary(spec, TESTLESS).ok, true);
});

test('#1885 negative: the same canary fails if the gate stops holding', () => {
  // The regression that matters most — the gate silently going soft.
  const notHeld = { ...TESTLESS, pr: { ...TESTLESS.pr, draft: false }, runRecord: '**Committed 2 file(s)**' };
  const spec = { id: 'tests-required', issue: 1875, expect: { draft: true, runRecordIncludes: 'tests: MISSING' } };
  assert.equal(checkCanary(spec, notHeld).ok, false);
});

test('filesMatch finds a test file without naming it', () => {
  const withTest = {
    pr: { number: 1, draft: false, changedFiles: ['packages/x/src/a.ts', 'packages/x/test/a.test.ts'] }
  };
  assert.equal(ASSERTIONS.filesMatch(withTest, '\\.(test|spec)\\.').ok, true);
  assert.equal(ASSERTIONS.filesMatch(HEALTHY, '\\.(test|spec)\\.').ok, false);
});

test('an unknown assertion FAILS rather than passing silently', () => {
  // The property that keeps the rig honest: a spec asking for something unimplemented must not
  // quietly count as a pass. That is exactly how a suite stops checking without anyone noticing.
  const r = checkCanary({ id: 'x', issue: 1, expect: { notARealAssertion: true } }, HEALTHY);
  assert.equal(r.ok, false);
  assert.match(r.results[0].detail, /unknown assertion/);
});

test('a missing observation fails instead of passing', () => {
  // A canary whose run never happened must not read as green.
  const { ok, rows } = checkAll([{ id: 'ghost', issue: 9, expect: { prOpened: true } }], {});
  assert.equal(ok, false);
  assert.equal(rows[0].ok, false);
});

test('the rollup is all-or-nothing', () => {
  const specs = [
    { id: 'good', issue: 1, expect: { prOpened: true } },
    { id: 'bad', issue: 2, expect: { prOpened: true } }
  ];
  const { ok } = checkAll(specs, { good: HEALTHY, bad: BROKEN_NO_PR });
  assert.equal(ok, false);
});

test('the report names every failing assertion', () => {
  const out = renderReport(checkAll(
    [{ id: 'packages-3-files', issue: 1874, expect: { prOpened: true, changedFileCount: 3 } }],
    { 'packages-3-files': BROKEN_NO_PR }
  ));
  assert.match(out, /🔴 Canary rig/);
  assert.match(out, /prOpened/);
  assert.match(out, /changedFileCount/);
});
