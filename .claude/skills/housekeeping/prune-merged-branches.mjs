#!/usr/bin/env node
/**
 * Lossless merged-branch sweep (#644, epic #633) — the ONLY auto-destructive janitor.
 *
 *   GITHUB_TOKEN=... [APPLY=true] node prune-merged-branches.mjs
 *
 * Deletes a remote branch ONLY if it is provably contained in `main` (0 commits ahead —
 * `git branch -r --merged origin/main`), so its commits already live in `main` and nothing
 * is lost. Lossless by construction. Everything that needs judgment (unmerged branches) is
 * left to the report-only digest (#635); this touches only the safe class.
 *
 * Safety:
 *   • never `main` / protected / default refs
 *   • never a branch with an OPEN PR
 *   • never a branch newer than BRANCH_MIN_AGE_DAYS (avoid sweeping a just-created branch)
 *   • dry-run UNLESS APPLY=true (report-only first; flip the gate when the output looks right)
 *
 * Env:
 *   GITHUB_TOKEN           (required)
 *   DIGEST_REPO            default "FriendlyInternet/nuxt-crouton"
 *   APPLY                  "true" to actually delete; anything else = dry-run
 *   BRANCH_MIN_AGE_DAYS    default 1
 */

import { execSync } from 'node:child_process'

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const [OWNER, NAME] = REPO.split('/')
const APPLY = process.env.APPLY === 'true'
const minAgeDays = Number(process.env.BRANCH_MIN_AGE_DAYS || 1)
const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('prune-merged-branches.mjs: GITHUB_TOKEN is required')
  process.exit(1)
}

import { shouldKeepEpicBranch } from '../../../scripts/epic-branch-keep.mjs'

const PROTECTED = new Set(['main', 'HEAD', 'gh-pages'])
const minAgeMs = Date.now() - minAgeDays * 86400 * 1000

async function gh(path, init) {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'housekeeping-prune'
    }
  })
  if (!res.ok && res.status !== 422 && res.status !== 404) {
    throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
  }
  return res
}

const git = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

// Branches whose commits are all already in origin/main.
let merged
try {
  merged = git('git branch -r --merged origin/main')
    .split('\n')
    .map((l) => l.trim().replace(/^origin\//, ''))
    .filter((b) => b && !b.startsWith('origin/') && !PROTECTED.has(b))
} catch (e) {
  console.error(`Could not compute merged branches (need full checkout + origin/main): ${e.message}`)
  process.exit(1)
}

// Tip date per branch, to skip very fresh ones.
const tipMs = {}
for (const line of git(
  "git for-each-ref --format='%(refname:short)|%(committerdate:iso8601)' refs/remotes/origin"
).split('\n')) {
  const [ref, date] = line.split('|')
  if (ref) tipMs[ref.replace(/^origin\//, '')] = Date.parse(date)
}

// Heads of all open PRs — never delete a branch with an open PR.
const openPRs = await (await gh(`/repos/${OWNER}/${NAME}/pulls?state=open&per_page=100`)).json()
const openHeads = new Set((Array.isArray(openPRs) ? openPRs : []).map((p) => p.head.ref))

const deletable = []
const skipped = []
for (const b of [...new Set(merged)]) {
  if (openHeads.has(b)) { skipped.push(`${b} (open PR)`); continue }
  // #2788: an epic branch lives while its epic issue is open, even when already merged to main.
  const epicNo = /^epic\/(\d+)-/.exec(b)?.[1]
  if (epicNo) {
    const r = await gh(`/repos/${OWNER}/${NAME}/issues/${epicNo}`)
    const state = r.ok ? (await r.json()).state : null
    if (shouldKeepEpicBranch(b, state)) { skipped.push(`${b} (epic #${epicNo} still open)`); continue }
  }
  if (tipMs[b] && tipMs[b] > minAgeMs) { skipped.push(`${b} (newer than ${minAgeDays}d)`); continue }
  deletable.push(b)
}
deletable.sort()

console.log(`Merged-into-main branches: ${merged.length} · deletable: ${deletable.length} · mode: ${APPLY ? 'APPLY' : 'dry-run'}`)
if (skipped.length) console.log('Skipped (kept):\n' + skipped.map((s) => `  - ${s}`).join('\n'))
if (!deletable.length) {
  console.log('Nothing to delete. ✨')
  process.exit(0)
}
console.log((APPLY ? 'Deleting:' : 'Would delete (dry-run):') + '\n' + deletable.map((b) => `  - ${b}`).join('\n'))

if (!APPLY) {
  console.log('\nDry-run — no branches were deleted. Set APPLY=true (repo var CLEANUP_BRANCHES_APPLY or dispatch input) to enable.')
  process.exit(0)
}

let deleted = 0
for (const b of deletable) {
  const res = await gh(`/repos/${OWNER}/${NAME}/git/refs/heads/${encodeURIComponent(b)}`, { method: 'DELETE' })
  if (res.ok || res.status === 404) {
    deleted++
    console.log(`🧹 deleted ${b}${res.status === 404 ? ' (already gone)' : ''}`)
  } else {
    console.log(`⚠️  could not delete ${b}: HTTP ${res.status}`)
  }
}
console.log(`Done — ${deleted}/${deletable.length} removed.`)
