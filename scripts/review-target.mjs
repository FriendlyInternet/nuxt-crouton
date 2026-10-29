#!/usr/bin/env node
// layer: stack
// review-target.mjs — before an agent asks the owner to look at a PR, check that PR is still live (#2111).
//
// WHY. On 2026-08-06 an agent told the owner to pin a review comment on #2039 — already merged —
// and had to be corrected toward the PR's own preview (#2020). A hold that names a dead target
// costs the owner a round trip on a phone, and it is checkable before posting.
//
// WHAT counts as "the target". Only the `**You:**` line of a brief that ASKS for something
// (every type but Done — owner-brief's `notifies` flag). That line is where the comment says
// what to do; numbers elsewhere are context and may rightly name merged work ("after #2495
// merged…"). Inside the line: `#N` refs and `/pull/N` links. A `#N` that turns out to be an
// issue, not a PR, is skipped — this checks PRs, nothing else.
//
// Split like owner-brief / packages-guard: the decision is PURE and unit-tested
// (review-target.test.mjs); the PR lookup is injected, so the hook, the CLI and the tests share it.
// Lookups that fail (network, rate limit) fail OPEN — a check about where to look must never be
// the reason a finding goes unreported.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { briefType, visiblePart } from './owner-brief.mjs'

const YOU_LINE = /^[ \t]*\**You:\**(.*)$/gmi

/** PR/issue numbers the owner is pointed at in an asking brief's `You:` line. PURE. */
export function reviewTargets(body) {
  const type = briefType(body)
  if (!type || !type.notifies) return []
  const nums = new Set()
  for (const [, line] of visiblePart(body).matchAll(YOU_LINE)) {
    const text = line.replace(/`[^`\n]*`/g, '') // a number in a code span is shown, not pointed at
    // One pass, so targets come back in reading order.
    for (const m of text.matchAll(/\/pull\/(\d+)|(?<![\w/&])#(\d+)\b/g)) nums.add(Number(m[1] ?? m[2]))
  }
  return [...nums]
}

/**
 * Judge looked-up targets. PURE.
 *   pulls: [{ number, kind: 'pr'|'issue'|'unknown', state?: 'open'|'closed', merged?: boolean }]
 * Only a PR that is closed or merged is stale; issues and failed lookups pass.
 */
export function judgeTargets(pulls = []) {
  const stale = pulls.filter(p => p.kind === 'pr' && p.state !== 'open')
    .map(p => ({ number: p.number, why: p.merged ? 'merged' : 'closed' }))
  return { ok: stale.length === 0, stale }
}

/** The refusal text the agent reads back. */
export function explainStale(stale) {
  const list = stale.map(s => `#${s.number} is already ${s.why}`).join('; ')
  return [
    `This comment asks the owner to look at a PR that is no longer live: ${list}.`,
    'Point the **You:** line at what to look at NOW — the open PR that replaced it, its own preview,',
    'or say plainly that the original target is gone. Do not send the owner to a closed PR. (#2111)',
  ].join('\n')
}

/** Look one number up with `gh`. Never throws: 404 → issue/unknown, any error → unknown. */
export function ghLookup(number, { repo = process.env.GITHUB_REPOSITORY || 'FriendlyInternet/nuxt-crouton', exec = execFileSync } = {}) {
  try {
    const out = exec('gh', ['api', `repos/${repo}/pulls/${number}`, '--jq', '{state: .state, merged: .merged}'],
      { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] })
    const { state, merged } = JSON.parse(out)
    return { number, kind: 'pr', state, merged: Boolean(merged) }
  } catch (e) {
    const msg = String(e.stderr || e.message || '')
    return { number, kind: /HTTP 404|Not Found/i.test(msg) ? 'issue' : 'unknown' }
  }
}

/** Full check: extract → look up → judge. `lookup` is injectable for tests; `repo` reaches the default one. */
export function checkReviewTargets(body, { lookup, repo } = {}) {
  const targets = reviewTargets(body)
  if (!targets.length) return { ok: true, stale: [], targets }
  const find = lookup || (n => ghLookup(n, repo ? { repo } : {}))
  return { ...judgeTargets(targets.map(find)), targets }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
//   node scripts/review-target.mjs <body-file>   → exit 0 if every PR in the You: line is open,
//                                                  exit 1 (reason on stderr) if one is merged/closed.
// For the paths the hook can't see: comments posted with `gh` from CI or the shell.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const file = process.argv[2]
  if (!file) { console.error('usage: node scripts/review-target.mjs <body-file>'); process.exit(2) }
  const v = checkReviewTargets(readFileSync(file, 'utf8'))
  if (v.ok) { console.log(`review targets ok (${v.targets.length ? v.targets.map(n => `#${n}`).join(', ') : 'none named'})`); process.exit(0) }
  console.error(explainStale(v.stale))
  process.exit(1)
}
