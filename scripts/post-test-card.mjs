#!/usr/bin/env node
// layer: stack
/**
 * Post the epic test card + set `status:to-test` once an epic is finished AND live on staging
 * (#2541, epic #2519). Run after a successful staging deploy of main.
 *
 *   GITHUB_TOKEN=... DEPLOYED_SHA=<sha> node scripts/post-test-card.mjs            # dry-run
 *   GITHUB_TOKEN=... DEPLOYED_SHA=<sha> APPLY=true node scripts/post-test-card.mjs # write
 *
 * For each open `epic`: all sub-issues closed AND the epic's merged epic/N-* → main PR is
 * contained in DEPLOYED_SHA (compare API) → one card comment (marker-guarded, never twice) +
 * `status:to-test`. The decision itself is the pure decideTestCard() in test-card.mjs.
 *
 * Env: GITHUB_TOKEN (required) · DEPLOYED_SHA (required) · DIGEST_REPO · APPLY
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { decideTestCard, buildCard, buildTestMail, extractChecks, extractSummary, deriveApps } from './test-card.mjs'
import { loadApps } from './deploy-detect.mjs'

const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
const [OWNER, NAME] = REPO.split('/')
const APPLY = process.env.APPLY === 'true'
const SHA = process.env.DEPLOYED_SHA
const token = process.env.GITHUB_TOKEN
if (!token || !SHA) {
  console.error('post-test-card.mjs: GITHUB_TOKEN and DEPLOYED_SHA are required')
  process.exit(1)
}

async function gh(path, init) {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'post-test-card',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {})
    }
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}
const labelNames = it => (it.labels || []).map(l => (typeof l === 'string' ? l : l.name))

// Is the epic's merged epic→main PR contained in the deployed commit?
async function mergedEpicPr(epicNumber) {
  const prs = await gh(`/repos/${OWNER}/${NAME}/pulls?state=closed&base=main&per_page=100`)
  return prs.find(p => p.merged_at && new RegExp(`^epic/${epicNumber}-`).test(p.head.ref))
}

async function isDeployed(epicNumber) {
  const pr = await mergedEpicPr(epicNumber)
  if (!pr?.merge_commit_sha) return false
  const cmp = await gh(`/repos/${OWNER}/${NAME}/compare/${pr.merge_commit_sha}...${SHA}`)
  return cmp.status === 'ahead' || cmp.status === 'identical'
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
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text })
  })
  console.log(`  test mail: Resend HTTP ${res.status}`)
}

const epics = (await gh(`/repos/${OWNER}/${NAME}/issues?state=open&labels=epic&per_page=100`))
  .filter(i => !i.pull_request)
let posted = 0
for (const e of epics) {
  const labels = labelNames(e)
  const subIssues = await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/sub_issues?per_page=100`).catch(() => [])
  const comments = await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/comments?per_page=100`).catch(() => [])
  // Only pay for the PR/compare lookups once the cheap checks pass.
  const cheap = decideTestCard({ subIssues, labels, comments, deployed: true })
  if (!cheap.post) { console.log(`  #${e.number} skip — ${cheap.reason}`); continue }
  const deployed = await isDeployed(e.number)
  const d = decideTestCard({ subIssues, labels, comments, deployed })
  if (!d.post) { console.log(`  #${e.number} skip — ${d.reason}`); continue }
  const hasApp = labels.some(n => n.startsWith('app:') || n.startsWith('poc:'))
  const info = appInfo(hasApp ? labels : [...labels, ...await derivedAppLabel(e).catch(() => [])])
  const checks = extractChecks(e.body || '')
  const body = buildCard({ epicNumber: e.number, title: e.title, ...info, checks })
  console.log(`  #${e.number} ${APPLY ? 'POST' : 'would post'} test card — ${d.reason}`)
  if (APPLY) {
    await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
    await gh(`/repos/${OWNER}/${NAME}/issues/${e.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: ['status:to-test'] }) })
    await sendMail(buildTestMail({
      epicNumber: e.number, title: e.title, app: info.app, summary: extractSummary(e.body || ''),
      checks, loginUrl: loginLink(info), epicUrl: e.html_url
    })).catch(err => console.warn(`::warning::test mail failed: ${err.message}`))
  }
  posted++
}
console.log(`post-test-card: ${APPLY ? 'APPLIED' : 'DRY-RUN'} · ${epics.length} open epics · ${posted} card(s)`)
