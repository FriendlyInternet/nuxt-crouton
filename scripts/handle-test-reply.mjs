#!/usr/bin/env node
/**
 * Handle the owner's reply to an epic test card (#2542, epic #2519).
 *
 *   `ok`              → status:to-test → status:verified
 *   `not ok: <note>`  → status:to-test → status:failed + a new sub-issue of the epic carrying <note>
 *
 * Parsing is parseTestReply() in approval.mjs; the decision here is the pure decideTestReply().
 * Labels are removed THEN added so the label events fire (adding one an issue already has is a no-op).
 *
 * Env: GITHUB_TOKEN · ISSUE_NUMBER · COMMENT_BODY · COMMENT_USER_TYPE · COMMENT_AUTHOR_ASSOCIATION · APPLY · DIGEST_REPO
 */
import { pathToFileURL } from 'node:url'
import { parseTestReply, isPreviewPin } from './approval.mjs'

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/**
 * @returns {{ act: false, reason: string } | { act: true, result: 'ok'|'not-ok', note: string }}
 */
export function decideTestReply({ labels = [], body = '', association = '' } = {}) {
  if (!labels.includes('status:to-test')) return { act: false, reason: 'not awaiting a test' }
  if (!TRUSTED.has(association)) return { act: false, reason: 'commenter is not the owner/a collaborator' }
  const { result, note } = parseTestReply(body)
  if (!result) return { act: false, reason: 'comment is not an ok / not ok reply' }
  return { act: true, result, note }
}

export const PIN_MARKER = '<!-- preview-pins -->'
const PIN_END = '<!-- /preview-pins -->'

/**
 * A `🎯 Preview feedback` pin (#3052). First pin on a status:to-test epic → fail it + create the pin
 * sub-issue; a later pin (epic already failed, sub-issue exists) → append to it; anything else ignored.
 * @param {{labels?:string[], body?:string, association?:string, userType?:string, pinIssue?:object|null}} i
 * @returns {{ act: false, reason: string } | { act: true, result: 'pin-first'|'pin-more', pin: string }}
 */
export function decidePin({ labels = [], body = '', association = '', userType = '', pinIssue = null } = {}) {
  if (!isPreviewPin(body)) return { act: false, reason: 'not a preview pin' }
  if (userType !== 'Bot' && !TRUSTED.has(association)) return { act: false, reason: 'pin is not from the feedback app or a collaborator' }
  const pin = String(body).trim()
  if (labels.includes('status:to-test')) return { act: true, result: pinIssue ? 'pin-more' : 'pin-first', pin }
  if (labels.includes('status:failed') && pinIssue) return { act: true, result: 'pin-more', pin }
  return { act: false, reason: 'epic is not awaiting a test' }
}

const quote = t => t.split('\n').map(l => `> ${l}`).join('\n')

/** Sub-issue carrying every pin of an epic; pins live between markers so appending is a splice. */
export function buildPinIssue({ epicNumber, pins }) {
  const first = String(pins[0]).split('\n').find(l => /^>/.test(l))?.replace(/^>\s*/, '') || 'preview feedback'
  return {
    title: `Fix: staging pins on #${epicNumber} — ${first.slice(0, 70)}`,
    body: [
      `Part of #${epicNumber}.`,
      '',
      '## 👤 For humans',
      `You pinned remarks on the staging preview of #${epicNumber}. They are collected here; later pins are added to this list.`,
      '',
      '## 🤖 For agents',
      `Each pin names the element and its source file. Fix them all and land it on the epic branch of #${epicNumber}.`,
      '',
      PIN_MARKER,
      pins.map(quote).join('\n\n'),
      PIN_END,
      '',
      '## 🧪 How to test',
      'Open the pinned pages on staging; none of the pinned problems remain.',
      '',
      `Dedup-checked: created from the first preview pin on #${epicNumber}; later pins append here.`
    ].join('\n')
  }
}

/** Add one pin to an existing pin sub-issue body. */
export function appendPin(body, pin) {
  const q = quote(pin)
  return String(body).includes(PIN_END) ? String(body).replace(PIN_END, `\n${q}\n${PIN_END}`) : `${body}\n\n${q}`
}

/**
 * A verified epic is done when every sub-issue is closed and its epic→main PR is merged (#2955).
 * `prs` are the PRs whose head is the epic's branch; with none, there is nothing unmerged to wait on.
 * @returns {{ close: true } | { close: false, comment: string }}
 */
export function decideEpicClose({ subIssues = [], prs = [] } = {}) {
  const openKids = subIssues.filter(i => i.state !== 'closed')
  const openPrs = prs.filter(p => p.state === 'open')
  const unmerged = !openPrs.length && prs.length && !prs.some(p => p.merged_at)
  const waiting = [
    ...openKids.map(i => `#${i.number} (sub-issue still open)`),
    ...openPrs.map(p => `#${p.number} (epic→main PR still open)`),
    ...(unmerged ? [`#${prs[0].number} (epic→main PR closed without merging)`] : [])
  ]
  if (!waiting.length) return { close: true }
  return { close: false, comment: `Verified, but left open — still waiting on: ${waiting.join(', ')}.` }
}

/** Body of the follow-up sub-issue created from a `not ok` note. */
export function buildFailureIssue({ epicNumber, note }) {
  const what = note || '(no detail given — owner replied `not ok`; ask what is wrong)'
  return {
    title: `Fix: test of #${epicNumber} failed — ${what.split('\n')[0].slice(0, 70)}`,
    body: [
      `Part of #${epicNumber}.`,
      '',
      '## 👤 For humans',
      `Your test of #${epicNumber} did not pass. What you wrote:`,
      '',
      ...what.split('\n').map(l => `> ${l}`),
      '',
      '## 🤖 For agents',
      `Reproduce the failure above on staging, fix it, and land it on the epic branch of #${epicNumber}.`,
      '',
      '## 🧪 How to test',
      'Re-run the epic test card; the reported problem no longer happens.',
      '',
      `Dedup-checked: created from the owner's \`not ok\` reply on #${epicNumber}; one per reply.`
    ].join('\n')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const token = process.env.GITHUB_TOKEN
  const number = Number(process.env.ISSUE_NUMBER)
  const REPO = process.env.DIGEST_REPO || 'FriendlyInternet/nuxt-crouton'
  const APPLY = process.env.APPLY === 'true'
  if (!token || !number) {
    console.error('handle-test-reply.mjs: GITHUB_TOKEN and ISSUE_NUMBER are required')
    process.exit(1)
  }
  const gh = async (path, init) => {
    const res = await fetch((process.env.GITHUB_API_URL_OVERRIDE || 'https://api.github.com') + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'handle-test-reply',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {})
      }
    })
    if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`)
    return res.status === 204 ? null : res.json()
  }
  const base = `/repos/${REPO}/issues/${number}`
  const issue = await gh(base)
  const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name))
  const PROV = '> 🤖 **pi.dev harness** · agent pipeline (CI) · _test-card reply handler (#2542)_'
  // Close a verified epic once its children and epic→main PR are all merged (#2955).
  const closeIfDone = async () => {
    const subIssues = await gh(`${base}/sub_issues?per_page=100`)
    const pulls = await gh(`/repos/${REPO}/pulls?state=all&base=main&per_page=100`)
    const prs = pulls.filter(p => p.head.ref.startsWith(`epic/${number}-`))
    const c = decideEpicClose({ subIssues, prs })
    const body = c.close ? 'Closed — verified, every sub-issue is closed and the epic is merged to main.' : c.comment
    await gh(`${base}/comments`, { method: 'POST', body: JSON.stringify({ body: `${body}\n\n${PROV}` }) })
    if (c.close) await gh(base, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) })
    console.log(`handle-test-reply: #${number} ${c.close ? 'closed' : 'left open'}`)
  }
  // Backfill: re-check an already-verified epic (CLOSE_VERIFIED=true, APPLY=true).
  if (process.env.CLOSE_VERIFIED === 'true' && labels.includes('status:verified') && issue.state === 'open') {
    if (APPLY) await closeIfDone()
    process.exit(0)
  }
  // Preview pins (#3052): the pin sub-issue is the one among the epic's children carrying PIN_MARKER.
  if (isPreviewPin(process.env.COMMENT_BODY)) {
    const kids = await gh(`${base}/sub_issues?per_page=100`)
    const pinIssue = kids.find(k => k.state !== 'closed' && String(k.body || '').includes(PIN_MARKER)) || null
    const p = decidePin({
      labels, body: process.env.COMMENT_BODY, association: process.env.COMMENT_AUTHOR_ASSOCIATION,
      userType: process.env.COMMENT_USER_TYPE, pinIssue
    })
    if (!p.act) { console.log(`handle-test-reply: skip #${number} — ${p.reason}`); process.exit(0) }
    console.log(`handle-test-reply: #${number} ${p.result}${APPLY ? '' : ' (dry-run)'}`)
    if (!APPLY) process.exit(0)
    if (p.result === 'pin-more') {
      await gh(`/repos/${REPO}/issues/${pinIssue.number}`, { method: 'PATCH', body: JSON.stringify({ body: appendPin(pinIssue.body, p.pin) }) })
      process.exit(0)
    }
    const { title, body } = buildPinIssue({ epicNumber: number, pins: [p.pin] })
    const child = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title, body, labels: ['type:fix'] }) })
    await gh(`${base}/sub_issues`, { method: 'POST', body: JSON.stringify({ sub_issue_id: child.id }) })
    await gh(`${base}/labels/${encodeURIComponent('status:to-test')}`, { method: 'DELETE' }).catch(() => {})
    await gh(`${base}/labels`, { method: 'POST', body: JSON.stringify({ labels: ['status:failed'] }) })
    await gh(`${base}/comments`, { method: 'POST', body: JSON.stringify({ body: `❌ Marked **failed** from your first pin. Pins are collected in #${child.number}.\n\n${PROV}` }) })
    process.exit(0)
  }
  const d = decideTestReply({
    labels,
    body: process.env.COMMENT_BODY,
    association: process.env.COMMENT_AUTHOR_ASSOCIATION
  })
  if (!d.act) {
    console.log(`handle-test-reply: skip #${number} — ${d.reason}`)
    process.exit(0)
  }
  const next = d.result === 'ok' ? 'status:verified' : 'status:failed'
  console.log(`handle-test-reply: #${number} ${d.result} → ${next}${APPLY ? '' : ' (dry-run)'}`)
  if (!APPLY) process.exit(0)

  let child = null
  if (d.result === 'not-ok') {
    const { title, body } = buildFailureIssue({ epicNumber: number, note: d.note })
    child = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title, body, labels: ['type:fix'] }) })
    await gh(`${base}/sub_issues`, { method: 'POST', body: JSON.stringify({ sub_issue_id: child.id }) })
  }
  await gh(`${base}/labels/${encodeURIComponent('status:to-test')}`, { method: 'DELETE' }).catch(() => {})
  await gh(`${base}/labels`, { method: 'POST', body: JSON.stringify({ labels: [next] }) })
  const msg = d.result === 'ok'
    ? '✅ Marked **verified** — thanks for testing.'
    : `❌ Marked **failed**. Your note became a new task: #${child.number}`
  await gh(`${base}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: `${msg}\n\n${PROV}` })
  })
  if (d.result === 'ok') await closeIfDone()
}
