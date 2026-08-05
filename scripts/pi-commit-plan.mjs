#!/usr/bin/env node
// pi-commit-plan.mjs — split a pi worker's changed files into TWO commits (#1849).
//
// WHY. The old Pattern B committed ONLY files pi hand-edited (the ledger) and dropped everything
// else as "generator output". But a crouton scaffold/generate task's deliverable IS generator
// output (`crouton config`/`generate_collection` write the collection via a CLI/MCP tool, not pi's
// editor), so the collection never landed and the PR merged green missing its whole point (#1830).
//
// FIX: don't EXCLUDE by "who typed it" — CLASSIFY, and commit both, preserving granular history:
//   • inputs    = the ledger (schema/config pi authored) → commit 1, the "why" (blame-able, small)
//   • generated = everything else that changed, MINUS the junk denylist → commit 2, the "what the
//                 machine produced" (labeled, derived)
// Junk (pi scratch, node_modules, .nuxt/.output/dist, telemetry) is still excluded via the SAME
// DENY regex the ledger uses — so we keep the anti-junk win and stop dropping real work.
//
// PURE given its inputs (session + the changed-file list); the workflow supplies the changed list
// from `git status --porcelain -uall`. Unit-tested in pi-commit-plan.test.mjs.
//
// Usage: node scripts/pi-commit-plan.mjs <session.jsonl> <repoRoot> <changed-files.txt>
//   changed-files.txt: one repo-relative path per line (untracked expanded to files, not dirs).
//   → prints JSON: { "inputs": [...], "generated": [...] }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DENY, ledgerFromSession } from './pi-edited-files.mjs';

// Pure core: given the ledger set + the changed-file list, produce the two ordered buckets.
export function planCommits({ ledger, changed }) {
  const led = ledger instanceof Set ? ledger : new Set(ledger);
  const seen = new Set();
  const changedClean = [];
  for (const raw of changed) {
    const p = String(raw).trim();
    if (!p || DENY.test(p) || seen.has(p)) continue;   // drop junk + dupes
    seen.add(p);
    changedClean.push(p);
  }
  // inputs = ledger files that actually changed (hand-authored, non-junk, existing).
  const inputs = changedClean.filter(p => led.has(p)).sort();
  // generated = everything else that changed and isn't junk (CLI/MCP output, new app dirs, etc.).
  const generated = changedClean.filter(p => !led.has(p)).sort();
  return { inputs, generated };
}

// Serialise ONE bucket to the exact bytes the finish step's readers need.
//
// A bucket file MUST end in a newline. `while IFS= read -r p` does NOT run the loop body for a
// final UNTERMINATED line, so a plain `.join('\n')` silently drops the LAST path in the bucket —
// which is how #1874's `nl.json` (the only file that ticket was actually about) never reached its
// commit while the run record still counted it, because `grep -c` DOES see that last line (#1876).
// Empty bucket → an empty file, never a blank line (a blank line would stage `$CONTENT/`).
export function serializeBucket(list) {
  const lines = (list || []).map(p => String(p).trim()).filter(Boolean);
  return lines.length ? lines.join('\n') + '\n' : '';
}

// Write both bucket files into `dir` as `inputs.txt` / `generated.txt`. The finish step calls this
// instead of serialising inline, so the round-trip is covered by pi-commit-plan.test.mjs rather
// than only in production (#1876).
export function writeBuckets(plan, dir) {
  fs.writeFileSync(path.join(dir, 'inputs.txt'), serializeBucket(plan.inputs));
  fs.writeFileSync(path.join(dir, 'generated.txt'), serializeBucket(plan.generated));
  return plan;
}

// I/O wrapper: read the ledger from the session and the changed list from a file.
export function planFromFiles(sessionPath, repoRoot, changedPath) {
  const ledger = fs.existsSync(sessionPath) ? ledgerFromSession(sessionPath, repoRoot) : new Set();
  const changed = fs.existsSync(changedPath)
    ? fs.readFileSync(changedPath, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    : [];
  return planCommits({ ledger, changed });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx === -1 ? null : argv[outIdx + 1];
  if (outIdx !== -1) argv.splice(outIdx, 2);
  const [sessionPath, repoRoot, changedPath] = argv;
  if (!sessionPath || !repoRoot || !changedPath || (outIdx !== -1 && !outDir)) {
    console.error('usage: pi-commit-plan.mjs <session.jsonl> <repoRoot> <changed-files.txt> [--out <dir>]');
    process.exit(2);
  }
  const plan = planFromFiles(sessionPath, repoRoot, changedPath);
  // --out writes the two bucket files directly (correctly terminated); stdout stays JSON either
  // way so the previous contract still holds.
  if (outDir) writeBuckets(plan, outDir);
  process.stdout.write(JSON.stringify(plan) + '\n');
}
