#!/usr/bin/env node
// pi-finish.mjs — testable decision core for the pi worker's FINISH step (#1893).
//
// WHY. Every defect found in `work-issue-pidev.yml`'s finish step so far (#1876: dropped last
// bucket file, `APP_DIR` grep killing the step on a packages/-only diff; #1885: silently-skipped
// tests gate) lived in shell that can only run on the self-hosted mac-mini against a real issue —
// nothing could exercise it before merge. This module ports the DECISION logic (not the git/`gh`
// side effects, which stay in the workflow) into pure, unit-testable functions.
//
// `session`/`plan` are wired via the CLI (#1904); the type-error functions (#3248) are not wired
// yet (#3249, polish list).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Newest *.jsonl in `dir`, or null. MUST NOT throw on a missing/empty dir — the #1876 `SESSION`
// bug: the shell's `ls "$dir"/*.jsonl` on an empty dir hit `set -e`+`pipefail` and killed the step
// before the `::warning::` fallback could run.
export function resolveSession(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const p = path.join(dir, f);
      return { path: p, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].path : null;
}

// Which app (if any) the committed files touch, for the typecheck acceptance gate. A diff that's
// entirely packages/**, .github/**, scripts/**, or docs matches nothing here — that's a legitimate
// `appDir: null`, NOT an error. The #1876 `APP_DIR` bug: the shell's `grep -hE '^(apps|pocs)/...'`
// exits 1 on no match, and `pipefail` propagated that through the whole step, killing it after the
// push but before `gh pr create` — #1874/#1875 pushed a branch and never opened a PR.
export function planAcceptance({ committedFiles }) {
  const files = committedFiles || [];
  for (const f of files) {
    const m = /^(apps|pocs)\/([^/]+)\//.exec(String(f).trim());
    if (m) return { appDir: `${m[1]}/${m[2]}` };
  }
  return { appDir: null };
}

// Hand-written packages/ LOGIC that landed with no test file (#1885). Scoped deliberately: only
// .ts/.mjs/.js under packages/, excluding the tests themselves, i18n locale JSON (a label-only
// change must NOT be held — #1874), and .vue (a visual change answers to the UI gate, not this one).
const LOGIC_RE = /^packages\/[^/]+\/.*\.(ts|mjs|js)$/;
const TEST_RE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./;

// #3411: judged over the WHOLE PR (this run's commits + `prFiles`), not just the last commit — a
// revision that touches only code on a PR that already has its test is not "missing a test".
export function planTestsGate({ committedFiles, prFiles }) {
  const files = [...new Set([...(committedFiles || []), ...(prFiles || [])]
    .map((f) => String(f).trim()).filter(Boolean))];
  const pkgLogic = files.filter((f) => LOGIC_RE.test(f) && !TEST_RE.test(f));
  const testFiles = files.filter((f) => TEST_RE.test(f));
  return { pkgLogic, testFiles, missing: pkgLogic.length > 0 && testFiles.length === 0 };
}

// Draft the PR (automerge skips drafts, #339) when acceptance failed OR tests are missing — both
// are "don't land this yet". `acceptance` is 'pass' | 'fail' | 'neutral'.
export function verdict({ acceptance, testsMissing }) {
  if (acceptance === 'fail') return { draft: true, reason: 'acceptance failed' };
  if (testsMissing) return { draft: true, reason: 'tests missing' };
  return { draft: false, reason: null };
}

// ── Type errors: in-diff vs pre-existing (#3248) ───────────────────────────────────────────
// The acceptance gate used to fail on EVERY app-local `error TS` line, so a PR was held for an
// error in a file it never touched (#3245: signin-link.post.ts, already broken on the base). The
// rule now: only errors in files the PR changed — judged over the WHOLE PR, every round — fail.
// Errors elsewhere pass and come back grouped, to be ticketed. A typecheck that never ran is
// still 'neutral', never 'pass' (#1849). Pure functions: no fs, no shell, no gh.

// `path(12,3): error TS2345: msg` or `path:12:3 - error TS2345: msg`, anywhere on the line (so a
// `##[error]` or pnpm prefix doesn't break it). Path chars exclude whitespace, parens, brackets.
const TS_ERR_RE = /([^\s()[\]]+?)(?:\((\d+),(\d+)\):|:(\d+):(\d+)\s+-)\s*error\s+(TS\d+):\s*(.*)$/;
const ANY_TS_RE = /error TS[0-9]/;

// → { errors: [{ file, line, col, code, text }], anyCount }. `errors` drops `../` paths (outside
// the app — the shell's OWN rule); `anyCount` counts every `error TS` line (the shell's ANY).
export function parseTsErrors(logText) {
  const errors = [];
  let anyCount = 0;
  for (const raw of String(logText || '').split('\n')) {
    if (!ANY_TS_RE.test(raw)) continue;
    anyCount += 1;
    const m = TS_ERR_RE.exec(raw);
    if (!m) continue;
    const file = m[1];
    if (file.startsWith('../')) continue;
    errors.push({
      file,
      line: Number(m[2] ?? m[4]),
      col: Number(m[3] ?? m[5]),
      code: m[6],
      text: m[7].trim(),
    });
  }
  return { errors, anyCount };
}

function toRepoPath(file, appDir) {
  const f = String(file).replace(/^(\.\/)+/, '');
  return appDir ? `${String(appDir).replace(/\/+$/, '')}/${f}` : f;
}

// → { acceptance: 'pass'|'fail'|'neutral', inDiff, notInDiff, message }. Same order as the shell:
// auto-import misses (TS2304 Cannot find name) → neutral; any in-diff error → fail; only
// not-in-diff → pass; none app-local → pass if it ran (exit 0 or any TS line), else neutral.
// The diff is the union of `committedFiles` (this run) and `prFiles` (the whole PR), like
// planTestsGate. Every error's `file` is returned in repo-root form.
export function classifyTypeErrors({ logText, tcExit, committedFiles, prFiles, appDir } = {}) {
  const diff = new Set([...(committedFiles || []), ...(prFiles || [])]
    .map((f) => String(f).trim().replace(/^(\.\/)+/, '')).filter(Boolean));
  const { errors, anyCount } = parseTsErrors(logText);
  const own = errors.map((e) => ({ ...e, file: toRepoPath(e.file, appDir) }));
  const inDiff = own.filter((e) => diff.has(e.file));
  const notInDiff = own.filter((e) => !diff.has(e.file));
  const where = appDir || 'the app';
  const autoImp = own.some((e) => e.code === 'TS2304' && e.text.startsWith('Cannot find name'));
  if (own.length && autoImp) {
    return { acceptance: 'neutral', inDiff, notInDiff, message: `typecheck env not prepared for ${where} (auto-imports unresolved) — not verified` };
  }
  if (inDiff.length) {
    return { acceptance: 'fail', inDiff, notInDiff, message: `${inDiff.length} type error(s) in files this PR changed in ${where}` };
  }
  if (notInDiff.length) {
    return { acceptance: 'pass', inDiff, notInDiff, message: `${notInDiff.length} error(s) in files this PR didn't touch` };
  }
  if (Number(tcExit) === 0 || anyCount > 0) {
    return { acceptance: 'pass', inDiff, notInDiff, message: `${where} typechecks clean${anyCount > 0 ? ' (ignored pre-existing error(s) elsewhere)' : ''}` };
  }
  return { acceptance: 'neutral', inDiff, notInDiff, message: `typecheck could not run for ${where} — not verified` };
}

// Group not-in-diff errors by file + TS code, each with a stable dedup marker for its ticket.
// Sorted count desc, then file, then code. → { toOpen: first maxTickets, rest }.
export function groupPreexisting(notInDiff, { maxTickets = 3 } = {}) {
  const map = new Map();
  for (const e of notInDiff || []) {
    const key = `${e.file}\u0000${e.code}`;
    if (!map.has(key)) {
      map.set(key, { file: e.file, code: e.code, count: 0, errors: [], marker: `<!-- preexisting-type-error:${e.file}:${e.code} -->` });
    }
    const g = map.get(key);
    g.count += 1;
    g.errors.push(e);
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const groups = [...map.values()].sort((a, b) => b.count - a.count || cmp(a.file, b.file) || cmp(a.code, b.code));
  return { toOpen: groups.slice(0, maxTickets), rest: groups.slice(maxTickets) };
}

// The run-record line: `acceptance: pass — N error(s) in files this PR didn't touch → #A, #B`.
export function formatAcceptanceLine({ count, issueNumbers = [], rest = [] } = {}) {
  let line = `acceptance: pass — ${count} error(s) in files this PR didn't touch`;
  if (issueNumbers.length) line += ` → ${issueNumbers.map((n) => `#${n}`).join(', ')}`;
  if (rest.length) line += `; not ticketed: ${rest.map((g) => `${g.file}:${g.code}`).join(', ')}`;
  return line;
}

// Read a newline-separated file list. Tolerates a missing file and an UNTERMINATED last line —
// the finish step's buckets are written by pi-commit-plan.mjs, and a bare `.join('\n')` there is
// exactly what silently dropped the last path in #1876. Splitting can't repeat that bug, but the
// tolerance is deliberate: this must never be the thing that loses a file again.
export function readFileList(p) {
  if (!p || !fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
}

// ── CLI (#1904) ───────────────────────────────────────────────────────────────────────────
// The workflow calls THIS instead of carrying its own shell copies of these decisions.
//
// Contract with the caller: every expected input EXITS 0 and prints something usable. A branch
// that exits non-zero here would reproduce the #1876 class exactly — the finish step runs under
// `set -e` + `pipefail`, so a non-zero probe kills it after the push and before `gh pr create`.
// "Nothing found" is a RESULT (empty value), never an error.
//
//   pi-finish.mjs session <dir>              → the newest *.jsonl path, or nothing
//   pi-finish.mjs plan <committed-files.txt> → APP_DIR= / PKG_LOGIC= / TEST_FILES= / TESTS_MISSING=
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg, arg2] = process.argv.slice(2);
  try {
    if (cmd === 'session') {
      process.stdout.write(`${resolveSession(arg) || ''}\n`);
    } else if (cmd === 'plan') {
      const committedFiles = readFileList(arg);
      const { appDir } = planAcceptance({ committedFiles });
      const { pkgLogic, testFiles, missing } = planTestsGate({ committedFiles, prFiles: readFileList(arg2) });
      process.stdout.write(
        `APP_DIR=${appDir || ''}\n`
        + `PKG_LOGIC=${pkgLogic.length}\n`
        + `TEST_FILES=${testFiles.length}\n`
        + `TESTS_MISSING=${missing ? 1 : 0}\n`
        + `PKG_LOGIC_FILES=${pkgLogic.join(',')}\n`
      );
    } else {
      console.error('usage: pi-finish.mjs session <dir> | plan <committed-files.txt> [<pr-files.txt>]');
      process.exit(2);
    }
  } catch (e) {
    // Even an unexpected fault must not take the step down: warn, emit the safe defaults, exit 0.
    console.error(`::warning::pi-finish ${cmd}: ${e.message}`);
    if (cmd === 'plan') process.stdout.write('APP_DIR=\nPKG_LOGIC=0\nTEST_FILES=0\nTESTS_MISSING=0\n');
    else process.stdout.write('\n');
  }
}
