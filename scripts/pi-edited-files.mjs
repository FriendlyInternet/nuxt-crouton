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
import fs from 'node:fs';
import path from 'node:path';

const [, , sessionPath, repoRootArg] = process.argv;
if (!sessionPath || !repoRootArg) {
  console.error('usage: pi-edited-files.mjs <session.jsonl> <repoRoot>');
  process.exit(2);
}
const repoRoot = path.resolve(repoRootArg);

// pi's file-writing tools. `edit` is confirmed (args: path/oldText/newText); the rest are
// defensive so a new-file `write` or a rename can't silently slip the ledger.
const WRITE_TOOLS = new Set(['edit', 'write', 'create', 'str_replace', 'multiedit', 'apply_patch']);
// Never commit pi's own runtime/scratch, dependency installs, or build output — even if a tool
// happened to touch them.
const DENY = /(^|\/)(\.pi|node_modules|\.nuxt|\.output|dist)(\/|$)|decompose-pidev-(prompt|exec)-\d+\.(txt|log)|(^|\/)pi-telemetry-out(\/|$)/;

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
// Only emit paths that still exist (a file pi created then deleted shouldn't be staged as add).
for (const rel of [...out].sort()) {
  if (fs.existsSync(path.join(repoRoot, rel))) process.stdout.write(rel + '\n');
}
