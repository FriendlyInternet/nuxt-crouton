#!/usr/bin/env node
/**
 * Deterministic data-gather for the "🔔 Waiting on you" digest — no LLM, no deps.
 *
 *   GITHUB_TOKEN=... node gather.mjs > waiting-on-you.data.json
 *
 * Lists every open issue/PR currently holding on an owner gesture — the single "what do I
 * need to do?" surface (#2113, part of epic #2108). REPORT-ONLY: it reads, it never mutates
 * a label, issue, or PR. Grouped by the kind of owner action needed, reusing the #2067
 * vocabulary: answer (a question is posted, pick between options) / action (do something the
 * agent isn't permitted to) / approval (review a diff or preview).
 *
 * Classification is by label + draft state, since that's all the pipeline already stamps:
 *   - `status:blocked`   → answer   (a 🔀 hold comment is waiting for a reply)
 *   - `status:needs-merge` → approval (green + approved, a human clicks merge)
 *   - an open PR still in `draft` state → approval (a UI/schema/test sign-off preview)
 *
 * Mirrors the shape of .claude/skills/housekeeping/gather.mjs.
 *
 * Env:
 *   GITHUB_TOKEN   (required) repo-scoped token; the Action passes the built-in one
 *   DIGEST_REPO    default "FriendlyInternet/nuxt-crouton"
 */

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('gather.mjs: GITHUB_TOKEN is required')
  process.exit(1)
}

// This digest posts to its own standing issue — don't let it list itself.
const STANDING_TITLE = process.env.WAITING_ON_YOU_ISSUE_TITLE || '🔔 Waiting on you'

async function gh(path) {
  const res = await fetch('https://api.github.com' + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'waiting-on-you-digest'
    }
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
  return res.json()
}
const search = async (q) =>
  (await gh(`/search/issues?per_page=100&q=${encodeURIComponent(q)}`)).items || []
const labelNames = (it) => (it.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
const ageDays = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000)
const toEntry = (it) => ({
  number: it.number,
  title: it.title,
  url: it.html_url,
  isPR: !!it.pull_request,
  draft: !!it.draft,
  ageDays: ageDays(it.updated_at)
})

async function gather() {
  const [blocked, needsMerge, openPRs] = await Promise.all([
    search(`repo:${REPO} is:open label:status:blocked`),
    search(`repo:${REPO} is:open label:status:needs-merge`),
    search(`repo:${REPO} is:pr is:open`)
  ])

  const answer = blocked
    .filter((i) => i.title !== STANDING_TITLE)
    .map(toEntry)
    .sort((a, b) => b.ageDays - a.ageDays)

  const approvalSeen = new Set()
  const approval = []
  for (const it of needsMerge) {
    if (it.title === STANDING_TITLE) continue
    if (approvalSeen.has(it.number)) continue
    approvalSeen.add(it.number)
    approval.push(toEntry(it))
  }
  for (const pr of openPRs) {
    if (!pr.draft) continue
    if (approvalSeen.has(pr.number)) continue
    approvalSeen.add(pr.number)
    approval.push(toEntry(pr))
  }
  approval.sort((a, b) => b.ageDays - a.ageDays)

  // "action" (do something the agent isn't permitted to, e.g. a workflow-file patch to
  // apply) has no dedicated label yet — surfaced only when a held issue's body carries the
  // ask-human "**Needs:** action" line. Best-effort text scan over the already-fetched
  // `answer` set, no extra API calls.
  const action = []
  for (const it of blocked) {
    if (it.title === STANDING_TITLE) continue
    const body = it.body || ''
    if (/\*\*Needs:\*\*\s*action\b/i.test(body)) {
      const entry = toEntry(it)
      action.push(entry)
    }
  }
  // An `action` item is a re-classification of an `answer` item, not an addition — drop it
  // from `answer` so nothing is double-counted.
  const actionNums = new Set(action.map((e) => e.number))
  const answerOnly = answer.filter((e) => !actionNums.has(e.number))

  return { answer: answerOnly, action, approval }
}

const groups = await gather()
const data = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  ...groups
}

process.stdout.write(JSON.stringify(data, null, 2) + '\n')
