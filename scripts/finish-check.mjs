#!/usr/bin/env node
// finish-check.mjs — "will the files I just changed go red in CI on Fallow or on the tests I
// touched?" (#3761, epic #3700). Looks ONLY at what the worker changed in this run: the
// uncommitted edits and new untracked files (`git status --porcelain -uall`, the list the
// workflow later commits), minus deletions and the workflow's own junk (`DENY`).
//
// Rule: green only when Fallow and the changed tests really ran on every changed file and found
// nothing. Anything it could not check is "not run", never green.
//
//   node scripts/finish-check.mjs [--json] [--timeout <ms>]
//   exit 0 green · 1 red · 2 not run (missing binary, not a git checkout, timeout, internal error)
//
// Always `--base HEAD` (owner decision on #3700): the worker has committed nothing, so HEAD is
// the point it branched from and the diff is exactly its own. Never reuse `fallowBaseArgs` from
// scripts/fallow-audit.mjs — without `--base` Fallow diffs against origin/main (#3519).
// Fallow audit takes no file list: it computes the changed set from git itself, so findings are
// filtered to our changed list afterwards. Baselines/thresholds come from `.fallowrc.json`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DENY } from './pi-edited-files.mjs';

export const DEFAULT_TIMEOUT_MS = 180000;
// The two quick git reads that find the changed list run under their own cap, not `--timeout`:
// "nothing changed" must answer before the time limit can (#3761 ticket-review fix).
const GIT_READ_TIMEOUT_MS = 30000;
const COVERAGE_FILE = 'coverage/coverage-final.json';
const COVERAGE_NOTE = 'no coverage file — CRAP results can differ from CI';
const BASELINE_FILES = new Set(['.fallow-health-baseline.json', '.fallow-dead-code-baseline.json', '.fallow-dupes-baseline.json']);
const NODE_TEST_RE = /^scripts\/(lib\/|metrics\/)?[^/]+\.test\.mjs$/;
const VITEST_RE = /^packages\/[^/]+\/.+\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_LIKE_RE = /[.-](test|spec)\.[cm]?[jt]sx?$/;
const IGNORE_RE = new RegExp('fallow' + '-ignore');
const PARKED_RE = /\b(it|test|describe)\.(skip|todo)\b/;
// Both `max*` (e.g. maxCrap) and `min*` (e.g. duplicates.minOccurrences) limits hide findings when raised.
const THRESHOLD_RE = /"((?:max|min)\w+)"\s*:\s*(\d+)/;
const NOT_COVERED = 'not covered by the finish check';
const NOT_INCLUDED = "not matched by its package's vitest include";

class NotRun extends Error {}

// ── git status ───────────────────────────────────────────────────────────────────────────────

const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * Git's C-style quoted path (`"my file.mjs"`, `"caf\303\251.mjs"`) → the real name. Unquoted
 * input is returned as is. Octal escapes are raw bytes, so the result is decoded as UTF-8.
 */
export function unquotePath(p) {
  const s = String(p);
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const bytes = [];
  const body = s.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') { bytes.push(...Buffer.from(body[i], 'utf8')); continue; }
    const oct = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; continue; }
    const next = body[++i];
    bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The path part of a porcelain line: a rename `a -> b` keeps `b`; either side may be quoted. */
function statusPath(rest) {
  const quotedTail = /(?:^|\s->\s)("(?:[^"\\]|\\.)*")$/.exec(rest);
  if (quotedTail) return unquotePath(quotedTail[1]);
  return unquotePath(rest.replace(/^(?:"(?:[^"\\]|\\.)*"|.*?) -> /, ''));
}

/** `git status --porcelain -uall` → changed (tracked + untracked), deleted, untracked. DENY dropped. */
export function parseStatus(porcelain) {
  const changed = new Set();
  const deleted = new Set();
  const untracked = new Set();
  for (const line of String(porcelain).split('\n')) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const file = statusPath(line.slice(3));
    if (DENY.test(file)) continue;
    if (xy.includes('D')) deleted.add(file);
    else changed.add(file);
    if (xy === '??') untracked.add(file);
  }
  return { changed: [...changed], deleted: [...deleted], untracked: [...untracked] };
}

// ── Fallow ───────────────────────────────────────────────────────────────────────────────────

/** The Fallow command. Always `--base HEAD`; coverage only when CI's coverage file exists. */
export function fallowCommand({ repoRoot, hasCoverage }) {
  const coverage = hasCoverage ? ['--coverage', COVERAGE_FILE, '--coverage-root', repoRoot] : [];
  return ['npx', ['--no-install', 'fallow', 'audit', '--base', 'HEAD', '--format', 'json', ...coverage]];
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function firstLine(text) {
  return String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
}

const metric = (f, key) => (f[key] == null ? null : `${key} ${f[key]}`);

function complexityFindings(report) {
  return (report.complexity?.findings || []).map((f) => ({
    file: f.path,
    line: f.line || 1,
    message: `${f.name} ${['cyclomatic', 'cognitive', 'crap'].map((k) => metric(f, k)).filter(Boolean).join(' / ')} (threshold exceeded)`,
    introduced: f.introduced,
  }));
}

const entryName = (e) => e.export_name || e.member_name || e.name || e.package_name || e.path;

function deadCodeFindings(report) {
  const out = [];
  for (const [key, list] of Object.entries(report.dead_code || {})) {
    if (!Array.isArray(list)) continue;
    for (const e of list) out.push({ file: e.path, line: e.line || 1, message: `${key}: ${entryName(e)}`, introduced: e.introduced });
  }
  return out;
}

function cloneFindings(report) {
  const out = [];
  for (const g of report.duplication?.clone_groups || []) {
    for (const i of g.instances || []) {
      out.push({ file: i.file, line: i.start_line || 1, message: `duplicated code (${g.line_count ?? '?'} lines)`, introduced: g.introduced });
    }
  }
  return out;
}

function relative(file, repoRoot) {
  return repoRoot && path.isAbsolute(file) ? path.relative(repoRoot, file) : file;
}

/**
 * Fallow's result → `{ ran, findings, reason }`. Exit 0 with JSON → nothing. Exit 1 with JSON
 * `verdict: fail` → the introduced findings on changed files (or one generic finding so a fail
 * is never hidden). Anything else (ENOENT, exit 2, unparseable) → `ran: false`.
 */
export function parseFallow(result, changedSet, repoRoot) {
  if (result.error) return { ran: false, findings: [], reason: `fallow could not run: ${result.error.message}` };
  const report = tryJson(result.stdout);
  // Exit 0 is clean only when Fallow said so: JSON without a `verdict` is not a result.
  if (result.code === 0 && typeof report?.verdict === 'string' && report.verdict !== 'fail') return { ran: true, findings: [] };
  if (result.code !== 1 || !report || report.verdict !== 'fail') {
    const why = report?.message || firstLine(result.stderr) || firstLine(result.stdout) || `exit ${result.code}`;
    return { ran: false, findings: [], reason: `fallow did not run cleanly: ${why}` };
  }
  const findings = [...complexityFindings(report), ...deadCodeFindings(report), ...cloneFindings(report)]
    .filter((f) => f.introduced !== false)
    .map(({ introduced, ...f }) => ({ ...f, file: relative(f.file, repoRoot) }))
    .filter((f) => changedSet.has(f.file));
  if (!findings.length) findings.push({ file: 'fallow', line: 0, message: 'verdict fail (no finding mapped to a changed file)' });
  return { ran: true, findings };
}

// ── tests ────────────────────────────────────────────────────────────────────────────────────

/** Sort changed files into node --test / vitest run / not run. `vitestIncludes(candidates)` → Set. */
export function selectTests(changed, { vitestIncludes }) {
  const node = changed.filter((f) => NODE_TEST_RE.test(f));
  const candidates = changed.filter((f) => VITEST_RE.test(f));
  const included = candidates.length ? vitestIncludes(candidates) : new Set();
  const vitest = candidates.filter((f) => included.has(f));
  const notRun = [];
  for (const f of changed) {
    if (node.includes(f) || vitest.includes(f)) continue;
    if (candidates.includes(f)) notRun.push({ file: f, reason: NOT_INCLUDED });
    else if (TEST_LIKE_RE.test(f)) notRun.push({ file: f, reason: NOT_COVERED });
  }
  return { node, vitest, notRun };
}

// ── suppression scan ─────────────────────────────────────────────────────────────────────────

/** `git diff HEAD --unified=0` → hunks `{ file, added: [{line,text}], removed: [text] }`. */
function parseDiff(diffText) {
  const s = { hunks: [], file: null, oldFile: null, header: false, hunk: null, next: 0 };
  for (const raw of String(diffText).split('\n')) {
    if (!diffHeaderLine(s, raw)) diffBodyLine(s, raw);
  }
  return s.hunks;
}

/** File headers and `@@` hunk headers; true when the line was one. */
function diffHeaderLine(s, raw) {
  if (raw.startsWith('diff --git ')) return Object.assign(s, { header: true, hunk: null });
  if (s.header && raw.startsWith('--- ')) return Object.assign(s, { oldFile: unquotePath(raw.slice(4)).replace(/^a\//, '') });
  if (s.header && raw.startsWith('+++ ')) return Object.assign(s, { file: raw === '+++ /dev/null' ? s.oldFile : unquotePath(raw.slice(4)).replace(/^b\//, '') });
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
  if (!m) return false;
  Object.assign(s, { header: false, next: Number(m[1]), hunk: { file: s.file, added: [], removed: [] } });
  s.hunks.push(s.hunk);
  return true;
}

function diffBodyLine(s, raw) {
  if (!s.hunk || s.header) return;
  if (raw.startsWith('+')) s.hunk.added.push({ line: s.next++, text: raw.slice(1) });
  else if (raw.startsWith('-')) s.hunk.removed.push(raw.slice(1));
  else if (raw.startsWith(' ')) s.next++;
}

function thresholdRaised(text, removed) {
  const m = THRESHOLD_RE.exec(text);
  if (!m) return null;
  const before = removed.map((r) => THRESHOLD_RE.exec(r)).find((r) => r && r[1] === m[1]);
  if (before && Number(m[2]) <= Number(before[2])) return null;
  return before ? `raises a Fallow threshold (${m[1]} ${before[2]} → ${m[2]})` : `raises a Fallow threshold (adds ${m[1]} ${m[2]})`;
}

function lineFindings(file, { line, text }, removed) {
  const out = [];
  if (IGNORE_RE.test(text)) out.push('adds a Fallow ignore comment');
  if (TEST_LIKE_RE.test(file) && PARKED_RE.test(text)) out.push('adds a skipped/todo test');
  if (path.basename(file) === '.fallowrc.json') out.push(thresholdRaised(text, removed));
  return out.filter(Boolean).map((message) => ({ file, line, message }));
}

/**
 * Added lines only: `+` lines of `git diff HEAD` and the whole content of untracked files.
 * `paths` = changed ∪ deleted, for the baseline-file check (deleted files count here, and only here).
 */
export function scanSuppressions({ diffText, untracked, paths }) {
  const findings = [];
  for (const h of parseDiff(diffText)) {
    for (const a of h.added) findings.push(...lineFindings(h.file, a, h.removed));
  }
  for (const [file, content] of Object.entries(untracked)) {
    String(content).split('\n').forEach((text, i) => findings.push(...lineFindings(file, { line: i + 1, text }, [])));
  }
  for (const p of paths) if (BASELINE_FILES.has(p)) findings.push({ file: p, line: 1, message: 'changes a Fallow baseline file' });
  return findings;
}

// ── orchestration ────────────────────────────────────────────────────────────────────────────

function timedOut(r) {
  return r.error?.code === 'ETIMEDOUT' || (r.signal && r.code == null);
}

/** One deadline for the whole run; each exec gets what is left. */
function makeRunner(deps, root, timeoutMs, start) {
  const deadline = start + timeoutMs;
  return (cmd, args) => {
    const left = deadline - deps.now();
    if (left <= 0) throw new NotRun(`timed out after ${timeoutMs}ms`);
    const r = deps.exec(cmd, args, { cwd: root, timeout: left });
    if (timedOut(r)) throw new NotRun(`timed out after ${timeoutMs}ms`);
    return r;
  };
}

/** Untracked contents for the scan; a file that cannot be read is reported as not scanned. */
function readUntracked(deps, root, files, state) {
  const out = {};
  for (const f of files) {
    try {
      out[f] = deps.readFile(path.join(root, f));
    } catch (err) {
      state.reasons.push(`suppression scan not run on ${f}: could not read it (${firstLine(err.message)})`);
    }
  }
  return out;
}

/** `git diff HEAD` text, or null (with a not-run reason) when git could not produce it. */
function readDiff(run, state) {
  const diff = run('git', ['diff', 'HEAD', '--unified=0', '--no-color', '--no-ext-diff']);
  if (!diff.error && diff.code === 0) return diff.stdout || '';
  state.reasons.push(`suppression scan not run: git diff failed (${firstLine(diff.stderr) || diff.error?.message || `exit ${diff.code}`})`);
  return null;
}

function vitestIncludesVia(run) {
  return (candidates) => {
    const r = run('npx', ['--no-install', 'vitest', 'list', '--filesOnly', ...candidates]);
    if (r.error || r.code !== 0) throw new NotRun(`vitest list failed: ${firstLine(r.stderr) || r.error?.message || `exit ${r.code}`}`);
    const out = String(r.stdout);
    return new Set(candidates.filter((f) => out.includes(f)));
  };
}

function runTestBatch(run, files, [cmd, args], state) {
  if (!files.length) return;
  const r = run(cmd, [...args, ...files]);
  if (r.error) {
    for (const f of files) state.notRun.push({ file: f, reason: `${cmd} could not run: ${r.error.message}` });
  } else if (r.code !== 0) {
    for (const f of files) state.findings.push({ file: f, line: 1, message: 'test failed' });
  }
}

function checkChanged(deps, run, root, status, state) {
  const diffText = readDiff(run, state);
  const untracked = readUntracked(deps, root, status.untracked, state);
  state.findings.push(...scanSuppressions({ diffText: diffText ?? '', untracked, paths: [...status.changed, ...status.deleted] }));
  if (!status.changed.length) return;
  const hasCoverage = deps.exists(path.join(root, COVERAGE_FILE));
  if (!hasCoverage) state.note = COVERAGE_NOTE;
  const [cmd, args] = fallowCommand({ repoRoot: root, hasCoverage });
  const fallow = parseFallow(run(cmd, args), new Set(status.changed), root);
  state.findings.push(...fallow.findings);
  if (!fallow.ran) state.reasons.push(fallow.reason);
  const tests = selectTests(status.changed, { vitestIncludes: vitestIncludesVia(run) });
  state.notRun.push(...tests.notRun);
  runTestBatch(run, tests.node, ['node', ['--test']], state);
  runTestBatch(run, tests.vitest, ['npx', ['--no-install', 'vitest', 'run']], state);
}

function notRunReason(state) {
  const reasons = [...state.reasons];
  if (state.notRun.length) {
    const n = state.notRun.length;
    reasons.push(`${n} changed test${n === 1 ? '' : 's'} not run: ${state.notRun.map((t) => `${t.file} — ${t.reason}`).join('; ')}`);
  }
  return reasons.join('; ');
}

/** red (any finding) outranks not-run (anything unchecked) outranks green. */
function verdict(state) {
  const reason = notRunReason(state);
  const status = state.findings.length ? 'red' : reason ? 'not-run' : 'green';
  const out = { status, exitCode: { green: 0, red: 1, 'not-run': 2 }[status], files: state.files, findings: state.findings };
  if (state.notRun.length) out.notRun = state.notRun;
  if (reason) out.reason = reason;
  if (state.note) out.note = state.note;
  return out;
}

function gitRead(deps, cwd, args) {
  const r = deps.exec('git', args, { cwd, timeout: GIT_READ_TIMEOUT_MS });
  if (timedOut(r)) throw new NotRun(`git ${args[0]} timed out after ${GIT_READ_TIMEOUT_MS}ms`);
  return r;
}

/**
 * deps = { exec(cmd, args, {cwd, timeout}) → {code, stdout, stderr, error, signal},
 *          readFile(absPath), exists(absPath), cwd, now(), timeoutMs? }
 */
export function finishCheck(deps) {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = deps.now();
  const state = { files: [], findings: [], notRun: [], reasons: [], note: undefined };
  try {
    const top = gitRead(deps, deps.cwd, ['rev-parse', '--show-toplevel']);
    if (top.error || top.code !== 0) throw new NotRun(`not a git checkout (${firstLine(top.stderr) || top.error?.message || `exit ${top.code}`})`);
    const root = String(top.stdout).trim();
    const st = gitRead(deps, root, ['status', '--porcelain', '-uall']);
    if (st.error || st.code !== 0) throw new NotRun(`git status failed: ${firstLine(st.stderr) || st.error?.message}`);
    const status = parseStatus(st.stdout);
    state.files = status.changed;
    if (!status.changed.length && !status.deleted.length) return { ...verdict(state), note: 'nothing changed' };
    checkChanged(deps, makeRunner(deps, root, timeoutMs, start), root, status, state);
  } catch (err) {
    state.reasons.push(err instanceof NotRun ? err.message : `internal error: ${err.message}`);
  }
  return verdict(state);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatText(r) {
  const head = {
    green: 'finish-check: green',
    red: `finish-check: RED (${plural(r.findings.length, 'finding')})`,
    'not-run': `finish-check: not run — ${r.reason}`,
  }[r.status];
  const lines = [head, ...r.findings.map((f) => `${f.file}:${f.line} — ${f.message}`)];
  for (const t of r.notRun || []) lines.push(`not run: ${t.file} — ${t.reason}`);
  if (r.status === 'red' && r.reason) lines.push(`also not checked: ${r.reason}`);
  if (r.note) lines.push(`note: ${r.note}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const json = argv.includes('--json');
  const i = argv.indexOf('--timeout');
  const timeoutMs = i >= 0 ? Number(argv[i + 1]) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error(`--timeout needs a number of ms, got ${argv[i + 1]}`);
  return { json, timeoutMs };
}

function realExec(cmd, args, { cwd, timeout }) {
  const r = spawnSync(cmd, args, { cwd, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error, signal: r.signal };
}

function main(argv) {
  let json = argv.includes('--json');
  let result;
  try {
    const args = parseArgs(argv);
    json = args.json;
    result = finishCheck({
      exec: realExec,
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      exists: (p) => fs.existsSync(p),
      cwd: process.cwd(),
      now: () => Date.now(),
      timeoutMs: args.timeoutMs,
    });
  } catch (err) {
    result = { status: 'not-run', exitCode: 2, files: [], findings: [], reason: `internal error: ${err.message}` };
  }
  const { exitCode, ...out } = result;
  console.log(json ? JSON.stringify(out, null, 2) : formatText(out));
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
