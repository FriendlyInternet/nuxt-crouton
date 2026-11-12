#!/usr/bin/env node
// Revise-run base guard (#2883). The revise step merges the base into the PR head and hands the
// merge commit to the finish step as REV_BASE. If that hand-off is lost, the finish step stacks
// its commit on the old PR head and the base's files show up as the PR's own (#2859). This runs
// right after the finish step's checkout and enforces the invariant: the base tip is an ancestor
// of HEAD, so the revision always sits on a merge commit that includes it.
//
//   node revise-base.mjs <baseRef> [--conflict] [--pr <n>] [--staged <file>[,<file>]] [--from <url>]
//
// Exit 0: already current, or merged now (reported). Exit 1: could not merge — fail loudly,
// never commit on the stale head. With --pr, the failure is also said on the PR (#3775): by then
// the worker's edit has been set aside, and a log line alone left the owner thinking it shipped.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

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
    // Read the clash before the abort empties it; git prints CONFLICT on stdout, not stderr (#3775).
    let conflicts = []
    try { conflicts = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean) } catch {}
    try { git('merge', '--abort') } catch {}
    const detail = [e.stdout, e.stderr].map((s) => String(s || '').trim()).filter(Boolean).join('\n') || String(e.message).trim()
    return { ok: false, action: 'failed', conflicts, message: `could not merge ${baseRef} into the revision: ${detail}` }
  }
}

const short = (sha) => String(sha || '').slice(0, 9)
const code = (xs) => xs.map((x) => `\`${x}\``).join(', ')

/** The PR comment for a revise whose edit the finish step had to drop (#3775). */
export function notPushedBody({ base, baseTip, head, staged = [], conflicts = [], from = '' }) {
  const change = from ? `[Your change](${from})` : 'Your change'
  const what = staged.length
    ? `The worker edited ${code(staged)}, but no commit with it was pushed`
    : 'Nothing was changed'
  const why = conflicts.length
    ? `\`${base}\` moved during the run (now \`${short(baseTip)}\`) and conflicts with this PR in ${code(conflicts)}`
    : `\`${base}\` moved during the run (now \`${short(baseTip)}\`) and could not be merged`
  return [
    '<!-- pipeline-note -->',
    '> 🤖 **pi.dev harness** · agent pipeline (CI) · _revision (#3775)_',
    '',
    `⚠️ **${change} was not pushed.** ${what}: ${why}. Nothing was committed; this PR is still at \`${short(head)}\`. Comment again to retry — the next run merges \`${base}\` first.`,
  ].join('\n')
}

/** Paths listed in the given files (one per line, blanks skipped), deduplicated. */
export function readStaged(files) {
  const out = []
  for (const f of files) {
    if (!f || !existsSync(f)) continue
    for (const l of readFileSync(f, 'utf8').split('\n')) if (l.trim() && !out.includes(l.trim())) out.push(l.trim())
  }
  return out
}

export function parseArgs(argv) {
  const o = { baseRef: '', conflict: false, pr: '', staged: [], from: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--conflict') o.conflict = true
    else if (a === '--pr') o.pr = argv[++i] || ''
    else if (a === '--staged') o.staged = String(argv[++i] || '').split(',').filter(Boolean)
    else if (a === '--from') o.from = argv[++i] || ''
    else if (!o.baseRef) o.baseRef = a
  }
  return o
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = parseArgs(process.argv.slice(2))
  const r = ensureBaseMerged({ baseRef: o.baseRef, conflict: o.conflict })
  console.log(`${r.ok ? '' : '::error::'}revise base (#2883): ${r.action} — ${r.message}`)
  if (r.action === 'merged') console.log(`::warning::${r.message}`)
  if (!r.ok && o.pr) {
    const rev = (ref) => { try { return execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim() } catch { return '' } }
    const body = notPushedBody({
      base: o.baseRef.replace(/^origin\//, ''), baseTip: rev(o.baseRef), head: rev('HEAD'),
      staged: readStaged(o.staged), conflicts: r.conflicts, from: o.from,
    })
    // Same pattern as revise-merge-guard.mjs: never let the comment itself crash the step.
    try { execFileSync('gh', ['pr', 'comment', o.pr, '--body', body], { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) {
      try { execFileSync('gh', ['issue', 'comment', o.pr, '--body', body], { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e2) {
        console.log(`::warning::could not post the not-pushed note on #${o.pr}: ${String(e2.stderr || e2.message).trim()}`)
      }
    }
  }
  process.exit(r.ok ? 0 : 1)
}
