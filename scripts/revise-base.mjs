#!/usr/bin/env node
// Revise-run base guard (#2883). The revise step merges the base into the PR head and hands the
// merge commit to the finish step as REV_BASE. If that hand-off is lost, the finish step stacks
// its commit on the old PR head and the base's files show up as the PR's own (#2859). This runs
// right after the finish step's checkout and enforces the invariant: the base tip is an ancestor
// of HEAD, so the revision always sits on a merge commit that includes it.
//
//   node revise-base.mjs <baseRef> [--conflict]
//
// Exit 0: already current, or merged now (reported). Exit 1: could not merge — fail loudly,
// never commit on the stale head.
import { execFileSync } from 'node:child_process'

export function ensureBaseMerged({ cwd = process.cwd(), baseRef, conflict = false }) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  // The conflict-choice path aborted the merge on purpose; nothing to enforce there.
  if (conflict) return { ok: true, action: 'skipped', message: 'conflict path — merge handled by the conflict step' }
  try {
    git('merge-base', '--is-ancestor', baseRef, 'HEAD')
    return { ok: true, action: 'current', message: `already contains ${baseRef}` }
  } catch {}
  try {
    git('merge', '--no-edit', baseRef)
    return { ok: true, action: 'merged', message: `base merge was missing at finish — merged ${baseRef} now` }
  } catch (e) {
    try { git('merge', '--abort') } catch {}
    return { ok: false, action: 'failed', message: `could not merge ${baseRef} into the revision: ${String(e.stderr || e.message).trim()}` }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [baseRef, flag] = process.argv.slice(2)
  const r = ensureBaseMerged({ baseRef, conflict: flag === '--conflict' })
  console.log(`${r.ok ? '' : '::error::'}revise base (#2883): ${r.action} — ${r.message}`)
  if (r.action === 'merged') console.log(`::warning::${r.message}`)
  process.exit(r.ok ? 0 : 1)
}
