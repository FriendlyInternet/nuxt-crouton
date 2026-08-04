#!/usr/bin/env node
// Extract the EXACT set of files a pi run created/modified, from its session log — the
// "Pattern B" commit strategy used by Aider (fnames → per-file git add) and claude-code-action
// (commit_files with an explicit files[]). We commit precisely this set instead of `git add -A`,
// so new needed files are included (pi wrote them) and tool/runtime/scratch artifacts are excluded
// BY CONSTRUCTION (pi never edited them) — no reliance on .gitignore foreseeing every artifact.
// See #1764/#1782 and the research: openai/codex#8548, SWE-agent/mini-swe-agent#528.
//
// Usage: node scripts/pi-edited-files.mjs <session.jsonl> <repoRoot>
//   → prints repo-relative paths (one per line) of files pi wrote to, deduped, existing only.
// Also EXPORTS `DENY` and `ledgerFromSession()` so the commit-plan splitter (pi-commit-plan.mjs,
// #1849) reuses the exact same junk-denylist and edit-tool parsing instead of duplicating them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pi's file-writing tools. `edit` is confirmed (args: path/oldText/newText); the rest are
// defensive so a new-file `write` or a rename can't silently slip the ledger.
export const WRITE_TOOLS = new Set(['edit', 'write', 'create', 'str_replace', 'multiedit', 'apply_patch']);
// Never commit pi's own runtime/scratch, dependency installs, or build output — even if a tool
// happened to touch them. Shared by the commit-plan splitter for the GENERATED bucket too (#1849).
export const DENY = /(^|\/)(\.pi|node_modules|\.nuxt|\.output|dist)(\/|$)|decompose-pidev-(prompt|exec)-\d+\.(txt|log)|(^|\/)pi-telemetry-out(\/|$)/;

// The set of repo-relative paths pi WROTE via its edit/write tools (deduped, in-repo, non-deny,
// existing). This is the "inputs / hand-authored" bucket — NOT generator output (which pi produced
// via a bash/MCP tool, so it never appears as a write-tool path). Pure given (session, repoRoot).
export function ledgerFromSession(sessionPath, repoRootArg) {
  const repoRoot = path.resolve(repoRootArg);
  const out = new Set();
  for (const line of fs.readFileSync(sessionPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type !== 'toolCall' || !WRITE_TOOLS.has(c.name)) continue;
      const a = c.arguments || {};
      for (const p of [a.path, a.file_path, a.filename, a.file, a.newPath, a.new_path]) {
        if (typeof p !== 'string' || !p) continue;
        const abs = path.resolve(repoRoot, p);
        if (abs !== repoRoot && !abs.startsWith(repoRoot + path.sep)) continue; // outside the repo
        const rel = path.relative(repoRoot, abs);
        if (!rel || rel.startsWith('..')) continue;
        if (DENY.test(rel)) continue;
        out.add(rel);
      }
    }
  }
  // Only keep paths that still exist (a file pi created then deleted shouldn't be staged as add).
  return new Set([...out].filter(rel => fs.existsSync(path.join(repoRoot, rel))));
}

// CLI (unchanged behaviour): print the ledger, one path per line.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , sessionPath, repoRootArg] = process.argv;
  if (!sessionPath || !repoRootArg) {
    console.error('usage: pi-edited-files.mjs <session.jsonl> <repoRoot>');
    process.exit(2);
  }
  for (const rel of [...ledgerFromSession(sessionPath, repoRootArg)].sort()) {
    process.stdout.write(rel + '\n');
  }
}
