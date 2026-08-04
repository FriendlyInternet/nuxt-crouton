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

// I/O wrapper: read the ledger from the session and the changed list from a file.
export function planFromFiles(sessionPath, repoRoot, changedPath) {
  const ledger = fs.existsSync(sessionPath) ? ledgerFromSession(sessionPath, repoRoot) : new Set();
  const changed = fs.existsSync(changedPath)
    ? fs.readFileSync(changedPath, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    : [];
  return planCommits({ ledger, changed });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , sessionPath, repoRoot, changedPath] = process.argv;
  if (!sessionPath || !repoRoot || !changedPath) {
    console.error('usage: pi-commit-plan.mjs <session.jsonl> <repoRoot> <changed-files.txt>');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(planFromFiles(sessionPath, repoRoot, changedPath)) + '\n');
}
