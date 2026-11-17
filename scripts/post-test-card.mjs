#!/usr/bin/env node
/**
 * Post the epic test card + set `status:to-test` once an epic is finished AND live on staging
 * (#2541, epic #2519). Run after a successful staging deploy of main.
 *
 *   GITHUB_TOKEN=... DEPLOYED_SHA=<sha> node scripts/post-test-card.mjs            # dry-run
 *   GITHUB_TOKEN=... DEPLOYED_SHA=<sha> APPLY=true node scripts/post-test-card.mjs # write
 *
 * For each open `epic`: all sub-issues closed AND the epic's merged epic/N-* → main PR is
 * contained in DEPLOYED_SHA (compare API) → one card per epic (marker-guarded), plus one fresh card
 * after a `not ok` fix's merge commit is in DEPLOYED_SHA (#4039) + `status:to-test`. The decision
 * itself is the pure decideTestCard() in test-card.mjs.
 * The card also lists each completed child's merged sub-PR + its last ✅ closing note (#3882).
 *
 * Env: GITHUB_TOKEN (required) · DEPLOYED_SHA (required) · DIGEST_REPO · APPLY
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { decideTestCard, buildCard, buildTestMail, extractChecks, extractSummary, deriveApps, buildEvidence } from './test-card.mjs'
import { loadApps } from './deploy-detect.mjs'

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const [OWNER, NAME] = REPO.split('/')
const APPLY = process.env.APPLY === 'true'
const SHA = () => process.env.DEPLOYED_SHA
const token = () => process.env.GITHUB_TOKEN

async function gh(path, init) {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token()}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'post-test-card',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {})
    }
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}
// Every page of a list endpoint (path must already carry `per_page=100`).
async function ghAll(path) {
  const all = []
  for (let page = 1; ; page++) {
    const items = await gh(`${path}${path.includes('?') ? '&' : '?'}page=${page}`)
    all.push(...(items || []))
    if (!items || items.length < 100) return all
  }
}
const labelNames = it => (it.labels || []).map(l => (typeof l === 'string' ? l : l.name))

// Is the epic's merged epic→main PR contained in the deployed commit?
async function mergedEpicPr(epicNumber) {
  const prs = await gh(`/repos/${OWNER}/${NAME}/pulls?state=closed&base=main&per_page=100`)
  return prs.find(p => p.merged_at && new RegExp(`^epic/${epicNumber}-`).test(p.head.ref))
}

// Is this commit contained in the deployed commit?
async function isContained(sha) {
  const cmp = await gh(`/repos/${OWNER}/${NAME}/compare/${sha}...${SHA()}`)
  return cmp.status === 'ahead' || cmp.status === 'identical'
}

// What the pipeline already checked (#3882): each completed child's merged sub-PR + closing note.
async function gatherEvidence(e, subIssues) {
  const epicPr = await mergedEpicPr(e.number)
  if (!epicPr) return []
  const mergedPrs = (await ghAll(`/repos/${OWNER}/${NAME}/pulls?state=closed&base=${encodeURIComponent(epicPr.head.ref)}&per_page=100`))
    .filter(p => p.merged_at)
  const commentsByIssue = {}
  for (const s of subIssues.filter(s => s.state === 'closed' && s.state_reason === 'completed')) {
    commentsByIssue[s.number] = (await ghAll(`/repos/${OWNER}/${NAME}/issues/${s.number}/comments?per_page=100`))
      .map(c => ({ login: c.user?.login, body: c.body, created_at: c.created_at }))
  }
  return buildEvidence({ subIssues, mergedPrs, commentsByIssue })
}

async function isDeployed(epicNumber) {
  const pr = await mergedEpicPr(epicNumber)
  return pr?.merge_commit_sha ? isContained(pr.merge_commit_sha) : false
}

/**
 * Is the latest `not ok` fix of a status:failed epic live on staging? (#4039) Injected I/O so it
 * is testable without network:
 *   timeline(n) → issue timeline events · pull(n) → PR object · isContained(sha) → boolean
 * The fix = the newest-closed `Fix: test of #<epic> failed` sub-issue. Its merge sha comes from a
 * cross-referenced PR merged into main — the `closed` event's commit_id is empty for API closes.
 */
export async function findFixDeployed({ epicNumber, subIssues = [], timeline, pull, isContained }) {
  const prefix = `Fix: test of #${epicNumber} failed`
  const fix = subIssues
    .filter(s => s.state === 'closed' && (s.title || '').startsWith(prefix))
    .sort((a, b) => (Date.parse(b.closed_at || 0) - Date.parse(a.closed_at || 0)) || (b.number - a.number))[0]
  if (!fix) return { fixDeployed: false, reason: `no "Fix: test of #${epicNumber} failed" sub-issue` }
  const fixIssue = fix.number
  const fixClosedAt = fix.closed_at || null
  const refs = ((await timeline(fixIssue)) || [])
    .filter(ev => ev.event === 'cross-referenced' && ev.source?.issue?.pull_request?.merged_at)
    .sort((a, b) => Date.parse(b.source.issue.pull_request.merged_at) - Date.parse(a.source.issue.pull_request.merged_at))
  for (const ev of refs) {
    const pr = await pull(ev.source.issue.number)
    if (pr?.base?.ref !== 'main' || !pr.merge_commit_sha) continue
    const sha = pr.merge_commit_sha
    const fixDeployed = Boolean(await isContained(sha))
    const tag = `fix ${sha.slice(0, 7)} (#${pr.number ?? ev.source.issue.number})`
    return { fixDeployed, reason: fixDeployed ? `${tag} is on staging` : `${tag} not in the deployed sha yet`, fixIssue, fixClosedAt, sha }
  }
  return { fixDeployed: false, reason: 'fix closed without a merge to main', fixIssue, fixClosedAt }
}

// No `app:`/`poc:` label → derive the app from what the merged epic PR deployed (#2748).
async function derivedAppLabel(epic) {
  const pr = await mergedEpicPr(epic.number)
  if (!pr) return []
  const files = (await gh(`/repos/${OWNER}/${NAME}/pulls/${pr.number}/files?per_page=100`)).map(f => f.filename)
  const ids = deriveApps({ changedFiles: files, apps: loadApps(), text: epic.body || '' })
  return ids.length === 1 ? [`app:${ids[0]}`] : []
}

function appInfo(labels) {
  const appId = labels.find(n => n.startsWith('app:'))?.slice(4) || ''
  const pocId = appId ? '' : labels.find(n => n.startsWith('poc:'))?.slice(4) || ''
  const id = appId || pocId
  let stagingUrl = ''
  let crudChecked
  if (id) {
    try {
      const cfg = JSON.parse(readFileSync(`${pocId ? 'pocs' : 'apps'}/${id}/deploy.config.json`, 'utf8'))
      stagingUrl = cfg.stagingUrl || ''
      crudChecked = Boolean(cfg.smoke?.crud)
    } catch { /* app without deploy config — card says so */ }
  }
  const app = id.charAt(0).toUpperCase() + id.slice(1)
  return { app, id, stagingUrl, crudChecked, reviewAccount: id ? `review+${id}-main@example.com` : '' }
}

// One-click sign-in link for the staging review account — same derivation as deploy-app.yml's
// "Seed review login" step (key = `main`). Goes ONLY into the email, never a comment (#2358).
function loginLink({ id, stagingUrl, reviewAccount }) {
  const secret = process.env.REVIEW_SEED_SECRET
  if (!secret || !id || !stagingUrl) return ''
  const password = createHash('sha256').update(`${secret}:${id}:main`).digest('hex').slice(0, 24)
  const q = new URLSearchParams({ email: reviewAccount, password })
  return `${stagingUrl}/auth/login?${q}`
}

// The single per-epic mail (#2518). Never fails the card: no key/vars → a warning, no mail.
async function sendMail({ subject, text }) {
  const { RESEND_API_KEY: key, RESEND_FROM: from } = process.env
  const to = process.env.REVIEW_LOGIN_EMAIL || process.env.DIGEST_REPORT_EMAIL
  if (!key || !from || !to) { console.warn('::warning::RESEND_API_KEY / RESEND_FROM / REVIEW_LOGIN_EMAIL not set — test mail not sent.'); return }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text })
  })
  console.log(`  test mail: Resend HTTP ${res.status}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (!token() || !SHA()) {
    console.error('post-test-card.mjs: GITHUB_TOKEN and DEPLOYED_SHA are required')
    process.exit(1)
  }
  const epics = (await gh(`/repos/${OWNER}/${NAME}/issues?state=open&labels=epic&per_page=100`))
    .filter(i => !i.pull_request)
  let posted = 0
  for (const e of epics) {
    const labels = labelNames(e)
    const subIssues = await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/sub_issues?per_page=100`).catch(() => [])
    const comments = await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/comments?per_page=100`).catch(() => [])
    // Only pay for the PR/compare lookups once the cheap checks pass.
    const cheap = decideTestCard({ subIssues, labels, comments, deployed: true, fixDeployed: true })
    if (!cheap.post) { console.log(`  #${e.number} skip — ${cheap.reason}`); continue }
    let d
    let fixIssue
    if (labels.includes('status:failed')) {
      const fix = await findFixDeployed({
        epicNumber: e.number,
        subIssues,
        timeline: n => gh(`/repos/${OWNER}/${NAME}/issues/${n}/timeline?per_page=100`),
        pull: n => gh(`/repos/${OWNER}/${NAME}/pulls/${n}`),
        isContained
      })
      console.log(`  #${e.number} fix — ${fix.reason}`)
      fixIssue = fix.fixIssue
      d = decideTestCard({ subIssues, labels, comments, deployed: false, fixDeployed: fix.fixDeployed, fixClosedAt: fix.fixClosedAt })
    } else {
      const deployed = await isDeployed(e.number)
      d = decideTestCard({ subIssues, labels, comments, deployed })
    }
    if (!d.post) { console.log(`  #${e.number} skip — ${d.reason}`); continue }
    const hasApp = labels.some(n => n.startsWith('app:') || n.startsWith('poc:'))
    const info = appInfo(hasApp ? labels : [...labels, ...await derivedAppLabel(e).catch(() => [])])
    const checks = extractChecks(e.body || '')
    const evidence = await gatherEvidence(e, subIssues).catch(err => { console.warn(`::warning::evidence skipped: ${err.message}`); return [] })
    const body = buildCard({ epicNumber: e.number, title: e.title, ...info, checks, evidence, ...(d.retest ? { fixIssue } : {}) })
    console.log(`  #${e.number} ${APPLY ? 'POST' : 'would post'} test card — ${d.reason} · evidence: ${evidence.length} entries`)
    if (APPLY) {
      await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
      if (d.retest) {
      // Only a 404 (label already gone) is fine; anything else fails the run loudly rather than
      // leaving status:failed + status:to-test together, which would strand the epic after `ok`.
        await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/labels/status%3Afailed`, { method: 'DELETE' })
          .catch((err) => { if (!String(err.message).includes('404')) throw err })
      }
      await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: ['status:to-test'] }) })
      await sendMail(buildTestMail({
        epicNumber: e.number, title: e.title, app: info.app, summary: extractSummary(e.body || ''),
        checks, loginUrl: loginLink(info), epicUrl: e.html_url, evidence
      })).catch(err => console.warn(`::warning::test mail failed: ${err.message}`))
    }
    posted++
  }
  console.log(`post-test-card: ${APPLY ? 'APPLIED' : 'DRY-RUN'} · ${epics.length} open epics · ${posted} card(s)`)
}
