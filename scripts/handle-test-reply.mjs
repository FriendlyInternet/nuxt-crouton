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
 * Env: GITHUB_TOKEN · ISSUE_NUMBER · COMMENT_BODY · COMMENT_AUTHOR_ASSOCIATION · APPLY · DIGEST_REPO
 */
import { pathToFileURL } from 'node:url'
import { parseTestReply } from './approval.mjs'
import { decideAutoClose } from './epic-auto-close.mjs'

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
    const res = await fetch('https://api.github.com' + path, {
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
  // A verified epic closes once it is on main and its postmortem is posted (#3012). The close itself
  // happens in postmortem.yml's `auto-close` job (Harness App token, so the follow-up workflows run —
  // a close made with this job's GITHUB_TOKEN would start none, #572). Here: say what is left, then
  // dispatch postmortem.yml (the one event GITHUB_TOKEN may trigger); it writes a missing postmortem
  // and its auto-close job decides.
  const handOff = async (currentLabels) => {
    const subIssues = await gh(`${base}/sub_issues?per_page=100`)
    const pulls = await gh(`/repos/${REPO}/pulls?state=all&base=main&per_page=100`)
    const prs = pulls.filter(p => p.head.ref.startsWith(`epic/${number}-`))
    const comments = await gh(`${base}/comments?per_page=100`)
    const prFiles = []
    for (const p of prs.filter(x => x.merged_at)) {
      prFiles.push(...(await gh(`/repos/${REPO}/pulls/${p.number}/files?per_page=100`)).map(f => f.filename))
    }
    const d = decideAutoClose({ state: issue.state, labels: currentLabels, subIssues, prs, comments, prFiles })
    const left = d.waiting.filter(w => !/^postmortem /.test(w))
    const body = left.length ? `Verified — closing once: ${left.join(', ')}.` : 'Verified — closing now.'
    await gh(`${base}/comments`, { method: 'POST', body: JSON.stringify({ body: `<!-- pipeline-note -->\n${body}\n\n${PROV}` }) })
    const { handoffExec } = await import('./handoff-exec.mjs')
    await handoffExec({ kind: 'dispatch', issue: number, workflow: 'postmortem.yml', inputs: { epic: String(number) } })
    console.log(`handle-test-reply: #${number} verified — ${d.reason}; postmortem.yml dispatched`)
  }
  // Backfill: re-check an already-verified epic (CLOSE_VERIFIED=true, APPLY=true).
  if (process.env.CLOSE_VERIFIED === 'true' && labels.includes('status:verified') && issue.state === 'open') {
    if (APPLY) await handOff(labels)
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
  if (d.result === 'ok') await handOff([...labels.filter(l => l !== 'status:to-test'), 'status:verified'])
}
