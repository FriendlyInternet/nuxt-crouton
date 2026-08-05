#!/usr/bin/env node
// pi-finish.mjs — testable decision core for the pi worker's FINISH step (#1893).
//
// WHY. Every defect found in `work-issue-pidev.yml`'s finish step so far (#1876: dropped last
// bucket file, `APP_DIR` grep killing the step on a packages/-only diff; #1885: silently-skipped
// tests gate) lived in shell that can only run on the self-hosted mac-mini against a real issue —
// nothing could exercise it before merge. This module ports the DECISION logic (not the git/`gh`
// side effects, which stay in the workflow) into pure, unit-testable functions.
//
// Deliberately NOT wired into work-issue-pidev.yml yet (#1893 scope) — the pi worker cannot touch
// .github/workflows/** (contract clause 4, policy #1076). The workflow rewiring is a follow-up.
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

export function planTestsGate({ committedFiles }) {
  const files = (committedFiles || []).map((f) => String(f).trim()).filter(Boolean);
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
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'session') {
      process.stdout.write(`${resolveSession(arg) || ''}\n`);
    } else if (cmd === 'plan') {
      const committedFiles = readFileList(arg);
      const { appDir } = planAcceptance({ committedFiles });
      const { pkgLogic, testFiles, missing } = planTestsGate({ committedFiles });
      process.stdout.write(
        `APP_DIR=${appDir || ''}\n`
        + `PKG_LOGIC=${pkgLogic.length}\n`
        + `TEST_FILES=${testFiles.length}\n`
        + `TESTS_MISSING=${missing ? 1 : 0}\n`
      );
    } else {
      console.error('usage: pi-finish.mjs session <dir> | plan <committed-files.txt>');
      process.exit(2);
    }
  } catch (e) {
    // Even an unexpected fault must not take the step down: warn, emit the safe defaults, exit 0.
    console.error(`::warning::pi-finish ${cmd}: ${e.message}`);
    if (cmd === 'plan') process.stdout.write('APP_DIR=\nPKG_LOGIC=0\nTEST_FILES=0\nTESTS_MISSING=0\n');
    else process.stdout.write('\n');
  }
}
