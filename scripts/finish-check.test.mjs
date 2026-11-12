// Contract for scripts/finish-check.mjs (#3761, epic #3700). Every side effect is injected:
// no real git, Fallow, node --test or vitest runs here — the fake `exec` answers by command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatus,
  fallowCommand,
  parseFallow,
  selectTests,
  scanSuppressions,
  finishCheck,
  formatText,
} from './finish-check.mjs';

const ROOT = '/repo';
// Built from parts so this file never itself "adds" the patterns it tests for.
const IGNORE = 'fallow' + '-ignore';
const SKIP = 'it' + '.skip(';
const TODO = 'test' + '.todo(';
const ONLY = 'it' + '.only(';

const PASS = { code: 0, stdout: JSON.stringify({ verdict: 'pass', complexity: { findings: [] } }), stderr: '' };

/** A fake world: status/diff/fallow/vitest answers, files on disk, and a log of every call. */
function world({
  status = '',
  diff = '',
  fallow = PASS,
  vitestList = '',
  files = {},
  exists = [],
  nodeTest = { code: 0, stdout: '', stderr: '' },
  vitestRun = { code: 0, stdout: '', stderr: '' },
  rootFails = false,
  timeoutMs,
  clock,
} = {}) {
  const calls = [];
  const reads = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.slice(0, 3).join(' ')}`;
    if (key.startsWith('git rev-parse')) {
      return rootFails
        ? { code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' }
        : { code: 0, stdout: `${ROOT}\n`, stderr: '' };
    }
    if (key.startsWith('git status')) return { code: 0, stdout: status, stderr: '' };
    if (key.startsWith('git diff')) return { code: 0, stdout: diff, stderr: '' };
    if (key.startsWith('npx --no-install fallow')) return fallow;
    if (key.startsWith('npx --no-install vitest') && args[2] === 'list') return { code: 0, stdout: vitestList, stderr: '' };
    if (key.startsWith('npx --no-install vitest') && args[2] === 'run') return vitestRun;
    if (cmd === 'node' && args[0] === '--test') return nodeTest;
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
  const readFile = (p) => {
    reads.push(p);
    const rel = p.startsWith(`${ROOT}/`) ? p.slice(ROOT.length + 1) : p;
    if (!(rel in files)) throw new Error(`ENOENT ${p}`);
    return files[rel];
  };
  const existsFn = (p) => exists.some((rel) => p === `${ROOT}/${rel}`);
  let t = 0;
  const now = clock || (() => t++);
  return { deps: { exec, readFile, exists: existsFn, cwd: ROOT, now, timeoutMs }, calls, reads };
}

const fallowFail = (report) => ({ code: 1, stdout: JSON.stringify({ verdict: 'fail', ...report }), stderr: '' });

// ── the five agreed cases (+ 6, aimed at the Rule) ──────────────────────────────────────────

test('1. a function over the complexity threshold → red with file:line, exit 1', () => {
  const { deps } = world({
    status: ' M scripts/a.mjs\n',
    fallow: fallowFail({ complexity: { findings: [{ path: 'scripts/a.mjs', line: 12, name: 'f', cyclomatic: 22, introduced: true }] } }),
  });
  const r = finishCheck(deps);
  assert.equal(r.status, 'red');
  assert.equal(r.exitCode, 1);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].file, 'scripts/a.mjs');
  assert.equal(r.findings[0].line, 12);
  assert.match(r.findings[0].message, /cyclomatic 22/);
});

test('2. a clean diff → green, exit 0', () => {
  const { deps } = world({ status: ' M scripts/a.mjs\n', diff: diffFor('scripts/a.mjs', 1, ['const x = 1;']) });
  const r = finishCheck(deps);
  assert.equal(r.status, 'green');
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.findings, []);
});

test('3. a diff that adds a Fallow ignore comment → red at that line, exit 1', () => {
  const { deps } = world({
    status: ' M scripts/a.mjs\n',
    diff: diffFor('scripts/a.mjs', 5, [`// ${IGNORE}-next-line complexity`]),
  });
  const r = finishCheck(deps);
  assert.equal(r.status, 'red');
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.findings.map((f) => `${f.file}:${f.line}`), ['scripts/a.mjs:5']);
});

test('4. Fallow not runnable (binary missing) → not-run, exit 2, never green', () => {
  const missing = { error: Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' }) };
  const r1 = finishCheck(world({ status: ' M scripts/a.mjs\n', fallow: missing }).deps);
  assert.equal(r1.status, 'not-run');
  assert.equal(r1.exitCode, 2);
  assert.match(r1.reason, /fallow/i);

  const garbage = { code: 1, stdout: 'npm ERR! could not determine executable to run', stderr: '' };
  const r2 = finishCheck(world({ status: ' M scripts/a.mjs\n', fallow: garbage }).deps);
  assert.equal(r2.status, 'not-run');
  assert.equal(r2.exitCode, 2);
  assert.notEqual(r2.status, 'green');
});

test('5. untracked files count; junk and deletions are not run', () => {
  const status = [
    ' D scripts/old.test.mjs',
    ' M scripts/a.mjs',
    '?? scripts/new.mjs',
    '?? decompose-pidev-prompt-1.txt',
    '?? pocs/status/tests/x.test.ts',
  ].join('\n');
  const { deps, calls, reads } = world({
    status,
    files: {
      'scripts/new.mjs': `export const a = 1;\nexport const b = 2;\n// ${IGNORE}\n`,
      'pocs/status/tests/x.test.ts': 'it("x", () => {});\n',
    },
  });
  const r = finishCheck(deps);
  assert.deepEqual(r.files, ['scripts/a.mjs', 'scripts/new.mjs', 'pocs/status/tests/x.test.ts']);
  const flat = calls.map((c) => c.join(' '));
  assert.ok(!flat.some((c) => c.startsWith('node --test') && c.includes('scripts/old.test.mjs')));
  assert.ok(!reads.some((p) => p.includes('decompose-pidev-prompt-1.txt')));
  assert.ok(!flat.some((c) => c.includes('decompose-pidev-prompt-1.txt')));
  assert.deepEqual(r.notRun, [{ file: 'pocs/status/tests/x.test.ts', reason: 'not covered by the finish check' }]);
  assert.ok(!r.findings.some((f) => f.file === 'pocs/status/tests/x.test.ts'));
  assert.deepEqual(r.findings.map((f) => `${f.file}:${f.line}`), ['scripts/new.mjs:3']);
  assert.equal(r.status, 'red');
  assert.equal(r.exitCode, 1);
});

test('6. the Rule: a changed test that could not be run is never green', () => {
  const pocs = finishCheck(world({ status: '?? pocs/status/tests/x.test.ts\n', files: { 'pocs/status/tests/x.test.ts': 'ok\n' } }).deps);
  assert.equal(pocs.status, 'not-run');
  assert.equal(pocs.exitCode, 2);
  assert.deepEqual(pocs.findings, []);
  assert.deepEqual(pocs.notRun, [{ file: 'pocs/status/tests/x.test.ts', reason: 'not covered by the finish check' }]);

  const spec = world({ status: ' M packages/crouton-core/test/e2e/a.spec.ts\n', vitestList: '' });
  const r2 = finishCheck(spec.deps);
  assert.equal(r2.status, 'not-run');
  assert.equal(r2.exitCode, 2);
  assert.match(r2.reason, /not matched by its package's vitest include/);
  assert.ok(!spec.calls.some((c) => c[0] === 'npx' && c[3] === 'run'));

  const deps = finishCheck(world({ status: '?? scripts/x.deps-test.mjs\n', files: { 'scripts/x.deps-test.mjs': 'ok\n' } }).deps);
  assert.equal(deps.status, 'not-run');
  assert.equal(deps.exitCode, 2);
});

// ── extra cases ──────────────────────────────────────────────────────────────────────────────

test('fallowCommand always passes --base HEAD; coverage only when the file exists', () => {
  const [cmd, without] = fallowCommand({ repoRoot: ROOT, hasCoverage: false });
  assert.equal(cmd, 'npx');
  assert.deepEqual(without.slice(0, 2), ['--no-install', 'fallow']);
  assert.ok(without.join(' ').includes('--base HEAD'));
  assert.ok(!without.includes('--coverage'));
  const [, withCov] = fallowCommand({ repoRoot: ROOT, hasCoverage: true });
  assert.ok(withCov.join(' ').includes('--base HEAD'));
  assert.ok(withCov.join(' ').includes(`--coverage coverage/coverage-final.json --coverage-root ${ROOT}`));
});

test('coverage file present → passed to Fallow, no note; absent → note', () => {
  const a = world({ status: ' M scripts/a.mjs\n', exists: ['coverage/coverage-final.json'] });
  const ra = finishCheck(a.deps);
  assert.ok(a.calls.some((c) => c.includes('--coverage')));
  assert.equal(ra.note, undefined);
  const b = world({ status: ' M scripts/a.mjs\n' });
  const rb = finishCheck(b.deps);
  assert.ok(!b.calls.some((c) => c.includes('--coverage')));
  assert.equal(rb.note, 'no coverage file — CRAP results can differ from CI');
});

test('nothing changed → green with note "nothing changed"', () => {
  const r = finishCheck(world({ status: '?? decompose-pidev-prompt-9.txt\n' }).deps);
  assert.equal(r.status, 'green');
  assert.equal(r.exitCode, 0);
  assert.equal(r.note, 'nothing changed');
});

test('--timeout 1 with one changed file → not-run "timed out"', () => {
  let t = 0;
  const r = finishCheck(world({ status: ' M scripts/a.mjs\n', timeoutMs: 1, clock: () => (t += 5) }).deps);
  assert.equal(r.status, 'not-run');
  assert.equal(r.exitCode, 2);
  assert.match(r.reason, /timed out after 1ms/);
});

test('an exec killed by its timeout → not-run "timed out"', () => {
  const killed = { code: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync npx ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
  const r = finishCheck(world({ status: ' M scripts/a.mjs\n', fallow: killed }).deps);
  assert.equal(r.status, 'not-run');
  assert.match(r.reason, /timed out/);
});

test('a git read killed by its timeout → not-run "timed out", not "not a git checkout"', () => {
  const { deps } = world();
  const exec = (cmd, args, opts) => (args[0] === 'rev-parse'
    ? { code: null, signal: 'SIGTERM', stdout: '', stderr: '', error: Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' }) }
    : deps.exec(cmd, args, opts));
  const r = finishCheck({ ...deps, exec });
  assert.equal(r.status, 'not-run');
  assert.match(r.reason, /timed out/);
  assert.doesNotMatch(r.reason, /not a git checkout/);
});

test('not a git checkout → not-run, exit 2', () => {
  const r = finishCheck(world({ rootFails: true }).deps);
  assert.equal(r.status, 'not-run');
  assert.equal(r.exitCode, 2);
  assert.match(r.reason, /not a git checkout/);
});

test('a deleted test alone next to a clean modified file → green (deletions do not count)', () => {
  const { deps, calls } = world({ status: ' D scripts/old.test.mjs\n M scripts/a.mjs\n' });
  const r = finishCheck(deps);
  assert.equal(r.status, 'green');
  assert.ok(!calls.some((c) => c[0] === 'node'));
});

test('changed node test runs with node --test; a failure is red', () => {
  const ok = world({ status: ' M scripts/a.test.mjs\n' });
  assert.equal(finishCheck(ok.deps).status, 'green');
  assert.ok(ok.calls.some((c) => c.join(' ') === 'node --test scripts/a.test.mjs'));
  const bad = finishCheck(world({ status: ' M scripts/metrics/a.test.mjs\n', nodeTest: { code: 1, stdout: '', stderr: '' } }).deps);
  assert.equal(bad.status, 'red');
  assert.deepEqual(bad.findings.map((f) => f.file), ['scripts/metrics/a.test.mjs']);
});

test('changed packages test included by vitest → vitest run', () => {
  const file = 'packages/crouton-core/tests/d1.test.ts';
  const w = world({ status: ` M ${file}\n`, vitestList: `[@fyit/crouton-core] ${file}\n` });
  const r = finishCheck(w.deps);
  assert.equal(r.status, 'green');
  assert.ok(w.calls.some((c) => c.join(' ') === `npx --no-install vitest run ${file}`));
});

test('.fallowrc.json raising a threshold is a finding; lowering is not', () => {
  const raised = scanSuppressions({
    diffText: [
      'diff --git a/.fallowrc.json b/.fallowrc.json',
      '--- a/.fallowrc.json',
      '+++ b/.fallowrc.json',
      '@@ -130 +130 @@',
      '-    "maxCrap": 30,',
      '+    "maxCrap": 60,',
    ].join('\n'),
    untracked: {},
    paths: ['.fallowrc.json'],
  });
  assert.deepEqual(raised.map((f) => `${f.file}:${f.line}`), ['.fallowrc.json:130']);
  assert.match(raised[0].message, /raises a Fallow threshold/);
  const lowered = scanSuppressions({
    diffText: ['diff --git a/.fallowrc.json b/.fallowrc.json', '--- a/.fallowrc.json', '+++ b/.fallowrc.json', '@@ -130 +130 @@', '-    "maxCrap": 60,', '+    "maxCrap": 30,'].join('\n'),
    untracked: {},
    paths: ['.fallowrc.json'],
  });
  assert.deepEqual(lowered, []);
});

test('a changed or deleted Fallow baseline file is a finding', () => {
  const f = scanSuppressions({ diffText: '', untracked: {}, paths: ['.fallow-health-baseline.json', '.fallow-dupes-baseline.json'] });
  assert.deepEqual(f.map((x) => `${x.file}:${x.line}`), ['.fallow-health-baseline.json:1', '.fallow-dupes-baseline.json:1']);
  const r = finishCheck(world({ status: ' D .fallow-dead-code-baseline.json\n' }).deps);
  assert.equal(r.status, 'red');
});

test('skip / todo added in a test is a finding; only is not', () => {
  const skip = scanSuppressions({ diffText: diffFor('scripts/a.test.mjs', 7, [`${SKIP}'x', () => {})`, `${TODO}'y')`]), untracked: {}, paths: [] });
  assert.deepEqual(skip.map((f) => `${f.file}:${f.line}`), ['scripts/a.test.mjs:7', 'scripts/a.test.mjs:8']);
  const only = scanSuppressions({ diffText: diffFor('scripts/a.test.mjs', 7, [`${ONLY}'x', () => {})`]), untracked: {}, paths: [] });
  assert.deepEqual(only, []);
  const notATest = scanSuppressions({ diffText: diffFor('scripts/a.mjs', 7, [`${SKIP}'x')`]), untracked: {}, paths: [] });
  assert.deepEqual(notATest, []);
});

test('parseStatus: renames take the new path, D in either column is deleted, DENY dropped', () => {
  const s = parseStatus('R  scripts/old.mjs -> scripts/new.mjs\nD  scripts/gone.mjs\n M .pi/settings.json\nAM scripts/x.mjs\n');
  assert.deepEqual(s.changed, ['scripts/new.mjs', 'scripts/x.mjs']);
  assert.deepEqual(s.deleted, ['scripts/gone.mjs']);
  assert.deepEqual(s.untracked, []);
});

test('parseFallow: dead code + clone instances map to changed files; unmapped fail stays red', () => {
  const changed = new Set(['scripts/a.mjs']);
  const out = parseFallow(fallowFail({
    dead_code: {
      summary: { total: 1 },
      unused_exports: [{ path: 'scripts/a.mjs', line: 3, export_name: 'unusedThing', introduced: true }, { path: 'scripts/a.mjs', line: 9, export_name: 'old', introduced: false }],
    },
    duplication: { clone_groups: [{ introduced: true, instances: [{ file: 'scripts/a.mjs', start_line: 20 }, { file: 'scripts/other.mjs', start_line: 4 }] }] },
  }), changed, ROOT);
  assert.equal(out.ran, true);
  assert.deepEqual(out.findings.map((f) => `${f.file}:${f.line}`), ['scripts/a.mjs:3', 'scripts/a.mjs:20']);
  assert.match(out.findings[0].message, /unused_exports: unusedThing/);

  const unmapped = parseFallow(fallowFail({ complexity: { findings: [{ path: 'scripts/other.mjs', line: 1, name: 'g', cyclomatic: 30, introduced: true }] } }), changed, ROOT);
  assert.equal(unmapped.findings.length, 1);
  assert.match(unmapped.findings[0].message, /verdict fail/);

  const errored = parseFallow({ code: 2, stdout: JSON.stringify({ message: 'could not determine changed files', exit_code: 2 }), stderr: '' }, changed, ROOT);
  assert.equal(errored.ran, false);
  assert.match(errored.reason, /could not determine changed files/);
});

test('selectTests sorts files into node / vitest / not run', () => {
  const s = selectTests(['scripts/a.test.mjs', 'scripts/lib/b.test.mjs', 'packages/p/tests/c.test.ts', 'packages/p/e2e/d.spec.ts', 'pocs/x/y.test.ts', 'scripts/a.mjs'], {
    vitestIncludes: () => new Set(['packages/p/tests/c.test.ts']),
  });
  assert.deepEqual(s.node, ['scripts/a.test.mjs', 'scripts/lib/b.test.mjs']);
  assert.deepEqual(s.vitest, ['packages/p/tests/c.test.ts']);
  assert.deepEqual(s.notRun, [
    { file: 'packages/p/e2e/d.spec.ts', reason: "not matched by its package's vitest include" },
    { file: 'pocs/x/y.test.ts', reason: 'not covered by the finish check' },
  ]);
});

test('formatText prints a summary line, file:line findings, not-run tests and the note', () => {
  const text = formatText({
    status: 'red',
    files: ['scripts/a.mjs'],
    findings: [{ file: 'scripts/a.mjs', line: 5, message: 'adds a Fallow ignore comment' }],
    notRun: [{ file: 'pocs/x.test.ts', reason: 'not covered by the finish check' }],
    note: 'no coverage file — CRAP results can differ from CI',
  });
  const lines = text.split('\n');
  assert.equal(lines[0], 'finish-check: RED (1 finding)');
  assert.ok(lines.includes('scripts/a.mjs:5 — adds a Fallow ignore comment'));
  assert.ok(lines.some((l) => l.includes('pocs/x.test.ts') && l.includes('not run')));
  assert.ok(lines.some((l) => l.includes('no coverage file')));
  assert.match(formatText({ status: 'not-run', files: [], findings: [], reason: 'timed out after 1ms' }), /^finish-check: not run — timed out after 1ms/);
  assert.match(formatText({ status: 'green', files: [], findings: [] }), /^finish-check: green/);
});

/** A minimal `git diff HEAD --unified=0` for added lines starting at `start` in `file`. */
function diffFor(file, start, added) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${start - 1},0 +${start},${added.length} @@`,
    ...added.map((l) => `+${l}`),
  ].join('\n');
}
