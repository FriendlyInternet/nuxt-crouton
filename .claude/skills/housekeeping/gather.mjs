#!/usr/bin/env node
/**
 * Deterministic data-gather for the weekly "🧹 Housekeeping" digest — no LLM, no deps.
 *
 *   GITHUB_TOKEN=... node gather.mjs > housekeeping.data.json
 *
 * Surfaces repo *drift* that needs a human eye but is too risky to auto-fix:
 * stale unmerged branches, mislabeled issues, stuck/quietly-finished tickets, and
 * idle PRs. It is REPORT-ONLY — it reads, it never mutates a branch, label, or issue.
 * The output JSON is consumed by render.mjs and posted to one standing issue (#635).
 *
 * Branch data comes from `git` (the workflow checks out with full history + all remote
 * branches); issue/PR data comes from the GitHub REST API, mirroring epic-digest's gather.
 *
 * Env:
 *   GITHUB_TOKEN              (required) repo-scoped token; the Action passes the built-in one
 *   DIGEST_REPO              default "FriendlyInternet/nuxt-crouton"
 *   HOUSEKEEPING_STALE_DAYS  default 14 — "no activity in N days" threshold
 */

import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const [OWNER, NAME] = REPO.split('/')
const staleDays = Number(process.env.HOUSEKEEPING_STALE_DAYS || 14)
const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('gather.mjs: GITHUB_TOKEN is required')
  process.exit(1)
}

const staleCutoffMs = Date.now() - staleDays * 86400 * 1000
// Protected/default refs the lossless-class janitor must never list or touch.
const PROTECTED = new Set(['main', 'HEAD', 'gh-pages'])
// This digest posts to its own standing issue — don't let it list itself.
const STANDING_TITLE = process.env.HOUSEKEEPING_ISSUE_TITLE || '🧹 Housekeeping'

async function gh(path) {
  const res = await fetch('https://api.github.com' + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'housekeeping-digest'
    }
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
  return res.json()
}
const search = async (q) =>
  (await gh(`/search/issues?per_page=100&q=${encodeURIComponent(q)}`)).items || []
const labelNames = (it) => (it.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
const ageDays = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000)

async function subIssues(number) {
  try {
    return await gh(`/repos/${OWNER}/${NAME}/issues/${number}/sub_issues?per_page=100`)
  } catch {
    return []
  }
}

// ── Stale unmerged branches (git) ────────────────────────────────────────────
// A branch is reportable iff it is NOT contained in main (still has unmerged commits)
// AND its tip hasn't moved in `staleDays`. Anything merged into main is lossless and is
// intentionally OUT of scope here (that's the auto-delete class, not a human-eye report).
function staleBranches() {
  const git = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()
  let merged
  try {
    // Names of remote branches whose commits all live in origin/main already.
    merged = new Set(
      git('git branch -r --merged origin/main')
        .split('\n')
        .map((l) => l.trim().replace(/^origin\//, ''))
        .filter(Boolean)
    )
  } catch {
    return null // no main ref / shallow checkout — skip the section rather than guess
  }
  const rows = git(
    "git for-each-ref --format='%(refname:short)|%(committerdate:iso8601)' refs/remotes/origin"
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [refRaw, date] = line.split('|')
      return { name: refRaw.replace(/^origin\//, ''), date }
    })
    .filter((b) => b.name && !PROTECTED.has(b.name) && !b.name.startsWith('origin/'))

  return rows
    .filter((b) => !merged.has(b.name)) // unmerged only
    .filter((b) => b.date && Date.parse(b.date) < staleCutoffMs)
    .map((b) => ({ name: b.name, lastCommit: b.date.slice(0, 10), ageDays: ageDays(b.date) }))
    .sort((a, b) => b.ageDays - a.ageDays)
}

// ── Label coverage (#636) ─────────────────────────────────────────────────────
// CLAUDE.md treats a missing pkg:/app:/poc:/worker: label as a build failure, but nothing
// checks that .github/labels.yml keeps up with the folders on disk. Compare each source
// dir against the declared labels. REPORT-ONLY — never auto-prune (deleting a label strips
// it from every issue, which is why labels.yml itself runs `skip_delete: true`).
function labelCoverage() {
  const labelsFile = '.github/labels.yml'
  if (!existsSync(labelsFile)) return null
  // No YAML dep — pull every declared `name: "..."` value (the file is a flat label list).
  const declared = new Set(
    [...readFileSync(labelsFile, 'utf8').matchAll(/^\s*-?\s*name:\s*["']?([^"'\n]+)["']?/gm)].map(
      (m) => m[1].trim()
    )
  )
  const dirs = (p) => {
    try {
      return readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
    } catch {
      return []
    }
  }
  // dir-prefix → label-prefix
  const map = [
    ['packages', 'pkg'],
    ['apps', 'app'],
    ['pocs', 'poc'],
    ['workers', 'worker']
  ]
  const missing = []
  for (const [dir, prefix] of map) {
    for (const name of dirs(dir)) {
      const label = `${prefix}:${name}`
      if (!declared.has(label)) missing.push({ dir: `${dir}/${name}`, expected: label })
    }
  }
  return missing.sort((a, b) => a.expected.localeCompare(b.expected))
}

// ── Issue / PR drift (API) ───────────────────────────────────────────────────
const COMPONENT_RE = /^(pkg|app|worker|poc):/

async function gather() {
  const [openIssues, openEpics, openPRs] = await Promise.all([
    search(`repo:${REPO} is:issue is:open -label:epic`),
    search(`repo:${REPO} is:issue is:open label:epic`),
    search(`repo:${REPO} is:pr is:open`)
  ])

  // Issues missing a type:* OR any component (pkg/app/worker/poc) label.
  const unlabeled = openIssues
    .filter((i) => i.title !== STANDING_TITLE)
    .map((i) => {
      const names = labelNames(i)
      const missing = []
      if (!names.some((n) => n.startsWith('type:'))) missing.push('type:*')
      if (!names.some((n) => COMPONENT_RE.test(n))) missing.push('component (pkg/app/worker/poc)')
      return missing.length ? { number: i.number, title: i.title, url: i.html_url, missing } : null
    })
    .filter(Boolean)

  // status:in-progress with no activity in N days (proxy for "stuck — no linked PR moving it").
  const stuck = openIssues
    .filter((i) => labelNames(i).includes('status:in-progress'))
    .filter((i) => Date.parse(i.updated_at) < staleCutoffMs)
    .map((i) => ({ number: i.number, title: i.title, url: i.html_url, ageDays: ageDays(i.updated_at) }))
    .sort((a, b) => b.ageDays - a.ageDays)

  // Epics whose sub-issues are ALL closed but the epic is still open (stale tracking).
  // Tag each with the action it needs, read from the label the labeller stamps (#763):
  // needs-postmortem (run the retro first) vs ready-to-close (postmortem done, just close).
  const staleEpics = []
  for (const e of openEpics) {
    const kids = await subIssues(e.number)
    if (kids.length > 0 && kids.every((k) => k.state === 'closed')) {
      const names = labelNames(e)
      const state = names.includes('status:ready-to-close')
        ? 'ready-to-close'
        : 'needs-postmortem' // default until/unless a postmortem marker flips the label
      staleEpics.push({ number: e.number, title: e.title, url: e.html_url, children: kids.length, state })
    }
  }

  // Idle open PRs — draft or not, nothing has moved in N days.
  const idlePRs = openPRs
    .filter((p) => Date.parse(p.updated_at) < staleCutoffMs)
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.html_url,
      ageDays: ageDays(p.updated_at),
      draft: !!p.draft
    }))
    .sort((a, b) => b.ageDays - a.ageDays)

  return { unlabeled, stuck, staleEpics, idlePRs }
}

const drift = await gather()
const data = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  staleDays,
  staleBranches: staleBranches(),
  labelCoverage: labelCoverage(),
  ...drift
}

process.stdout.write(JSON.stringify(data, null, 2) + '\n')
