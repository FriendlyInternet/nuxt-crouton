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
import { computeSkillFreshness } from '../../../scripts/skill-freshness.mjs'

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

// ── Loop Station budget readout (#934, WS4) ───────────────────────────────────
// Read-only: the producer (WS1) writes writeups/loop-station/history.jsonl; this
// reporter just surfaces the latest point + delta as one digest line. No LLM, no
// recompute. Null (line omitted) when the inventory hasn't run yet.
function loopStationBudget() {
  const file = 'writeups/loop-station/history.jsonl'
  if (!existsSync(file)) return null
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  if (lines.length === 0) return null
  const recs = lines
    .slice(-2)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const latest = recs[recs.length - 1]
  const prev = recs.length > 1 ? recs[recs.length - 2] : null
  if (!latest) return null
  const tok = (r) => r?.totals?.alwaysOnTokens ?? null
  return {
    alwaysOnTokens: tok(latest),
    redundancyPct: latest.redundancy?.pct ?? null,
    scorecard: latest.scorecard?.overall ?? null,
    tokenizer: latest.tokenizer ?? null,
    commit: latest.commit ?? null,
    deltaTokens: prev && tok(latest) != null && tok(prev) != null ? tok(latest) - tok(prev) : null
  }
}

// ── Skill freshness (#1100 WS3) ───────────────────────────────────────────────
// Read-only: reuse scripts/skill-freshness.mjs (fs+git, no LLM) to surface knowledge-skills
// whose cited paths drifted or whose `verified:` stamp aged out. Returns just the flagged
// skills + a summary so render.mjs can show a "📚 Skill freshness" band (omitted when clean).
// Null (section dropped) if the checker throws — never blocks the rest of the digest.
function skillFreshness() {
  try {
    const r = computeSkillFreshness()
    const flagged = r.skills
      .filter((s) => s.vanished.length || s.possiblyStale.length || s.overdue)
      .map((s) => ({
        name: s.name,
        stamp: s.stamp,
        ageDays: s.ageDays,
        overdue: s.overdue,
        vanished: s.vanished,
        possiblyStale: s.possiblyStale
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return {
      today: r.today,
      staleDays: r.staleDays,
      summary: r.summary,
      flagged,
      malformed: r.malformed.map((m) => ({ name: m.name, reason: m.reason }))
    }
  } catch {
    return null
  }
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

  // One pass over open epics (sub-issues fetched once each) computes two facts about
  // the parent↔child status relationship (#763 / #980):
  //   • staleEpics — ALL children closed but the epic is still open (closing side).
  //     Tagged with the action it needs from the label the labeller stamps:
  //     needs-postmortem (run the retro first) vs ready-to-close (postmortem done).
  //   • epicsMissingInProgress — ≥1 child is `status:in-progress` but the epic itself
  //     isn't labelled in-progress, so it reads as "open, not started" (the opening
  //     side, #980).
  // Both are REPORT-ONLY; scripts/label-ready-epics.mjs is what reconciles the labels.
  const staleEpics = []
  const epicsMissingInProgress = []
  for (const e of openEpics) {
    const kids = await subIssues(e.number)
    const names = labelNames(e)
    if (kids.length > 0 && kids.every((k) => k.state === 'closed')) {
      const state = names.includes('status:ready-to-close')
        ? 'ready-to-close'
        : 'needs-postmortem' // default until/unless a postmortem marker flips the label
      staleEpics.push({ number: e.number, title: e.title, url: e.html_url, children: kids.length, state })
    } else if (!names.includes('status:in-progress')) {
      const active = kids.filter(
        (k) => k.state === 'open' && labelNames(k).includes('status:in-progress')
      )
      if (active.length) {
        epicsMissingInProgress.push({
          number: e.number,
          title: e.title,
          url: e.html_url,
          activeChildren: active.map((k) => k.number).sort((a, b) => a - b)
        })
      }
    }
  }

  // In-progress issues whose parent isn't a currently-open epic — a closed epic left
  // with an unfinished child, or a parent that should carry the `epic` label but
  // doesn't (#980). Uses parent_issue_url already on the search payload (zero extra
  // API calls). Standalone in-progress tasks (no parent) are allowed → skipped.
  const openEpicNums = new Set(openEpics.map((e) => e.number))
  const orphanedInProgress = openIssues
    .filter((i) => labelNames(i).includes('status:in-progress') && i.parent_issue_url)
    .map((i) => {
      const parent = Number(i.parent_issue_url.split('/').pop())
      return Number.isNaN(parent) || openEpicNums.has(parent)
        ? null
        : { number: i.number, title: i.title, url: i.html_url, parent }
    })
    .filter(Boolean)
    .sort((a, b) => a.parent - b.parent)

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

  return { unlabeled, stuck, staleEpics, epicsMissingInProgress, orphanedInProgress, idlePRs }
}

const drift = await gather()
const data = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  staleDays,
  staleBranches: staleBranches(),
  labelCoverage: labelCoverage(),
  loopStation: loopStationBudget(),
  skillFreshness: skillFreshness(),
  ...drift
}

process.stdout.write(JSON.stringify(data, null, 2) + '\n')
