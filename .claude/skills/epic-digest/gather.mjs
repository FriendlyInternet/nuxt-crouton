#!/usr/bin/env node
/**
 * Deterministic data-gather for the epic digest — no LLM, no deps.
 *
 *   GITHUB_TOKEN=... node gather.mjs > digest.data.json
 *
 * Pulls the open-epic tree, the last-24h activity band, and the loose
 * (unparented) tickets straight from the GitHub REST API, parses each epic's
 * "Hypothesis" / "We'll know by" out of its body, computes a plain "Where we are"
 * from the child counts, and emits the exact JSON shape render.mjs consumes.
 *
 * This is the engine behind the scheduled daily run (.github/workflows/epic-digest.yml).
 * The interactive /epic-digest skill gathers via GitHub MCP instead; both feed render.mjs.
 *
 * Env:
 *   GITHUB_TOKEN          (required) repo-scoped token; the Action passes the built-in one
 *   DIGEST_REPO           default "FriendlyInternet/nuxt-crouton"
 *   DIGEST_WINDOW_HOURS   default 24
 */

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const [OWNER, NAME] = REPO.split('/')
const windowHours = Number(process.env.DIGEST_WINDOW_HOURS || 24)
const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('gather.mjs: GITHUB_TOKEN is required')
  process.exit(1)
}

const cutoffMs = Date.now() - windowHours * 3600 * 1000
const cutoff = new Date(cutoffMs).toISOString().slice(0, 10) // YYYY-MM-DD

// The digest posts to its own standing issue — don't let it list itself.
const STANDING_TITLE = process.env.DIGEST_ISSUE_TITLE || '📊 Daily epic digest'
const notStanding = (i) => i.title !== STANDING_TITLE

async function gh(path) {
  const res = await fetch('https://api.github.com' + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'epic-digest'
    }
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
  return res.json()
}
const search = async (q) =>
  (await gh(`/search/issues?per_page=100&q=${encodeURIComponent(q)}`)).items || []
const slim = (it, kind) => ({
  number: it.number,
  title: it.title,
  url: it.html_url || `https://github.com/${REPO}/issues/${it.number}`,
  kind
})

// ── body parsing (deterministic) ────────────────────────────────────────────
function section(body, re) {
  if (!body) return ''
  const lines = body.split(/\r?\n/)
  const i = lines.findIndex((l) => re.test(l))
  if (i < 0) return ''
  const out = []
  for (let j = i + 1; j < lines.length; j++) {
    if (/^##\s/.test(lines[j])) break
    out.push(lines[j])
  }
  return out.join('\n').trim()
}
const firstSentence = (s) => {
  s = String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  const m = s.match(/^(.*?[.!?])(\s|$)/)
  return (m ? m[1] : s).trim()
}
function parseHypothesis(body) {
  // Match the new `## Hypothesis` heading and the legacy `## 🎯 The bet` so the
  // digest keeps surfacing the framing for epics written before the rename (#426).
  const sec = section(body, /^##\s.*(hypothesis|bet)/i)
  if (!sec) return ''
  const flat = sec.replace(/\*\*/g, '')
  const m = flat.match(/We think that[\s\S]*?(?:that'?s what we want\.?|that is what we want\.?)/i)
  return (m ? m[0] : firstSentence(sec)).replace(/\s+/g, ' ').trim()
}
function parseKnowBy(body) {
  if (!body) return ''
  const m = body.replace(/\*\*/g, '').match(/We'?ll know by[^\n]*/i)
  if (!m) return ''
  return m[0].replace(/^.*?We'?ll know by[:\s—-]*/i, '').replace(/\s+/g, ' ').trim()
}
const labelNames = (it) => (it.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
const statusOfLabels = (names) =>
  names.includes('status:blocked') ? 'blocked'
  : names.includes('status:in-progress') ? 'in-progress'
  : undefined
const typeOfLabels = (names) => (names.find((n) => n.startsWith('type:')) || '').replace(/^type:/, '')

// ── actionables (the "Needs your eyes" band) ────────────────────────────────
// Surface what LANDED with the human "How to test" steps the author already
// wrote — every closeable PR/issue is required to carry a `## 🧪 How to test`
// section, and a completed epic gets a `## 🧪 Verify the whole thing` rollup.
// Turn a `🧪`-section's body into a clean list of numbered/bulleted steps.
const stepsFrom = (sec) =>
  String(sec || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(\d+[.)]|[-*])\s+/.test(l))
    .map((l) => l.replace(/^(\d+[.)]|[-*])\s+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim())
    .filter(Boolean)
// Prefer the literal "How to test"; fall back to any other 🧪 section (e.g. an
// epic that titled it "We'll be right if / We'll know by").
const parseTestSteps = (body) =>
  stepsFrom(section(body, /^##\s.*how to test/i) || section(body, /^##\s.*🧪/i))
// A staging/prod preview link if the author dropped one in the body.
const parsePreviewUrl = (body) => {
  // Exclude backtick/quotes/angle-brackets too, so a Markdown inline-code or
  // linked URL (`https://…dev`) doesn't capture a trailing ` / " / > delimiter.
  const m = String(body || '').match(/https?:\/\/[^\s)`"'<>]+\.(?:pmcp\.dev|friendlyinter\.net)[^\s)`"'<>]*/)
  return m ? m[0] : undefined
}
// A `fix · merged` / `feat · merged` badge from a conventional-commit title.
const prBadge = (title) => {
  const m = String(title || '').match(/^(\w+)(?:\([^)]*\))?!?:/)
  return m ? `${m[1]} · merged` : 'merged'
}
// "Visual change" = the PR touched a UI surface or wears a UI sign-off label.
const VISUAL_FILE = /\.(?:vue|css)$|app\/(?:components|layouts|pages)\//
const VISUAL_PKG = /crouton-(?:themes|editor)/
const isVisualPR = (files, names) =>
  files.some((f) => VISUAL_FILE.test(f.filename) || VISUAL_PKG.test(f.filename)) ||
  names.some((n) => n === 'ui-approved' || n.startsWith('ui:'))

async function prDetail(number) {
  try {
    const [pr, files] = await Promise.all([
      gh(`/repos/${OWNER}/${NAME}/pulls/${number}`),
      gh(`/repos/${OWNER}/${NAME}/pulls/${number}/files?per_page=100`).catch(() => [])
    ])
    return { body: pr.body || '', labels: labelNames(pr), files: Array.isArray(files) ? files : [] }
  } catch {
    return { body: '', labels: [], files: [] }
  }
}
async function issueComments(number) {
  try {
    return await gh(`/repos/${OWNER}/${NAME}/issues/${number}/comments?per_page=100`)
  } catch {
    return []
  }
}

async function subIssues(number) {
  try {
    return await gh(`/repos/${OWNER}/${NAME}/issues/${number}/sub_issues?per_page=100`)
  } catch {
    return [] // sub-issues API unavailable / none
  }
}

// ── gather ───────────────────────────────────────────────────────────────────
const childNumbers = new Set()

const epicItems = await search(`repo:${REPO} is:issue is:open label:epic`)
const epics = []
for (const e of epicItems) {
  const kids = await subIssues(e.number)
  let done = 0, anyBlocked = false, inProgress = 0, closedInWindow = 0
  const children = kids.map((c) => {
    childNumbers.add(c.number)
    const names = labelNames(c)
    const status = statusOfLabels(names)
    if (c.state === 'closed') {
      done++
      if (c.closed_at && Date.parse(c.closed_at) >= cutoffMs) closedInWindow++
    }
    if (status === 'blocked') anyBlocked = true
    if (status === 'in-progress') inProgress++
    return { number: c.number, title: c.title, url: c.html_url, state: c.state, ...(status ? { status } : {}) }
  })
  const total = children.length
  const epicNames = labelNames(e)
  const blocked = anyBlocked || epicNames.includes('status:blocked')
  // "Finished but still open" state (#763), stamped on the epic by label-ready-epics.mjs —
  // the single source of truth. These REPLACE the old "done"-on-an-open-epic badge (which
  // read as a contradiction: an open epic showing "Done"). open/in-progress stay as-is:
  // in-progress = a child is actively worked; open = ready to pick up.
  const readyToClose = epicNames.includes('status:ready-to-close')
  const needsPostmortem = epicNames.includes('status:needs-postmortem')
  const allDone = total > 0 && done >= total

  const parts = [`${done}/${total} done`]
  if (blocked) parts.push('blocked')
  else if (inProgress) parts.push(`${inProgress} in progress`)
  if (closedInWindow) parts.push(`${closedInWindow} closed in last ${windowHours}h`)
  const whereWeAre = parts.join(' · ')

  // Prefer the stamped label; fall back to needs-postmortem when all children are closed
  // but the labeller hasn't run yet — so a fully-delivered epic is never shown as plain "done".
  const status = blocked ? 'blocked'
    : readyToClose ? 'ready-to-close'
    : (needsPostmortem || allDone) ? 'needs-postmortem'
    : inProgress ? 'in-progress'
    : 'open'

  epics.push({
    number: e.number, title: e.title, url: e.html_url,
    status, blocked, total, done, readyToClose, needsPostmortem,
    theHypothesis: parseHypothesis(e.body),
    weWillKnowBy: parseKnowBy(e.body),
    whereWeAre,
    children
  })
}

const [closed, opened, mergedPRs, openNonEpic] = await Promise.all([
  search(`repo:${REPO} is:issue is:closed closed:>=${cutoff}`),
  search(`repo:${REPO} is:issue created:>=${cutoff}`),
  search(`repo:${REPO} is:pr is:merged merged:>=${cutoff}`),
  search(`repo:${REPO} is:issue is:open -label:epic`)
])

const loose = openNonEpic
  .filter((i) => !i.parent_issue_url && !childNumbers.has(i.number) && notStanding(i))
  .map((i) => ({ number: i.number, title: i.title, url: i.html_url, type: typeOfLabels(labelNames(i)) || 'other' }))

// Actionables — built from data already in flight: merged PRs in the window get
// their `🧪 How to test` steps + a visual flag; epics that hit 100% (done, but
// still open → awaiting QA + close) get their `🧪 Verify the whole thing` rollup.
const PR_ACTIONABLE_CAP = 15 // how many merged PRs to surface in the band
const PR_DETAIL_FETCH_CAP = 40 // bound the body-fetch work in wide (backfill) windows
// Fetch details first, THEN trim — so when a wide window blows past the display
// cap we keep the PRs that actually carry test steps rather than whatever the
// search happened to return first (a 24h window is well under the cap → no-op).
const prDetailed = await Promise.all(
  mergedPRs.slice(0, PR_DETAIL_FETCH_CAP).map(async (pr) => {
    const { body, labels, files } = await prDetail(pr.number)
    return {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      kind: 'pr',
      label: prBadge(pr.title),
      hasVisual: isVisualPR(files, labels),
      testSteps: parseTestSteps(body),
      ...(parsePreviewUrl(body) ? { previewUrl: parsePreviewUrl(body) } : {})
    }
  })
)
prDetailed.sort((a, b) => (b.testSteps.length ? 1 : 0) - (a.testSteps.length ? 1 : 0))
const prActionables = prDetailed.slice(0, PR_ACTIONABLE_CAP)
const completeEpics = epics.filter((e) => e.total > 0 && e.done >= e.total)
const epicActionables = await Promise.all(
  completeEpics.map(async (e) => {
    const cmts = await issueComments(e.number)
    const rollup = [...cmts].reverse().find((c) => /##\s.*verify the whole thing/i.test(c.body || ''))
    return {
      number: e.number,
      title: e.title,
      url: e.url,
      kind: 'epic',
      hasVisual: false,
      testSteps: rollup ? stepsFrom(section(rollup.body, /^##\s.*verify the whole thing/i)) : []
    }
  })
)
const actionables = [...epicActionables, ...prActionables]

const data = {
  generatedAt: new Date().toISOString(),
  windowHours,
  repo: REPO,
  activity: {
    opened: opened.filter(notStanding).map((i) => slim(i, 'issue')),
    closed: closed.filter(notStanding).map((i) => slim(i, 'issue')),
    mergedPRs: mergedPRs.map((i) => slim(i, 'pr'))
  },
  actionables,
  epics,
  loose
}

process.stdout.write(JSON.stringify(data, null, 2) + '\n')
