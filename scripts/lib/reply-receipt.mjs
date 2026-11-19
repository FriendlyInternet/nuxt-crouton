#!/usr/bin/env node
// The reply receipt (#4207, epic #4101 step 6): one plain line at the END of a held question
// saying how the owner's newest reply to it was read, so a misread shows up at once instead of
// hours later when the wrong thing (or nothing) happens.
//
//   <!-- reply-receipt at=<iso> -->
//   ↩️ [Your reply](<url>) (19 Nov 10:28, Europe/Brussels) was read as **yes** → re-planning with your yes.
//   <!-- /reply-receipt -->
//
// The receipt never sits in the leading marker block, so no reader of the question
// (readRecord, isPlanHold, ownerQuestionKind, …) sees it. One block per question: a newer reply
// replaces it; an older reply (a slow run) never puts a stale line back.
//
// CLI (the `receipt` job in on-comment.yml): env GH_TOKEN, GITHUB_REPOSITORY, COMMENT_ID (the
// question), KIND, STARTS, REASON (the router's decision), REPLY_URL, REPLY_AT (the reply).
import { pathToFileURL } from 'node:url'

const STARTS = {
  'replan-with-yes': 'read as **yes** → re-planning with your yes',
  'replan-with-feedback': 'read as **a comment** → passed to the planner',
  'answer-worker': 'read as **your answer** → passed to the worker',
}

const KINDS = {
  'approve-plan': 'read as **ok with a reason** → plan approved, building',
  'plan-needs-reason': 'read as **ok without a reason** → asked you for the reason',
  resume: 'read as **a reply** → the paused work picks it up',
  interpret: 'read as **a comment**, not an answer',
  dispatch: '**not an answer** — handled as a command',
  'close-epic': '**not an answer** — handled as a command',
  'fresh-branch': '**not an answer** — handled as a command',
  'quiz-reply': '**not an answer** — handled as a quiz / test-card reply',
  'test-card': '**not an answer** — handled as a quiz / test-card reply',
}

/** One line of plain text: no newlines, no HTML comment delimiters (they would end the block). */
const plain = (s) => String(s ?? '').replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim()

/** PURE. `19 Nov 10:28` in Europe/Brussels time. */
export function brusselsTime(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(fmt.formatToParts(new Date(date)).map((x) => [x.type, x.value]))
  return `${p.day} ${p.month} ${p.hour}:${p.minute}`
}

/** PURE. What the router decided, in plain words (never a raw kind name). */
export function readAs({ kind, starts, reason } = {}) {
  if (starts && STARTS[starts]) return STARTS[starts]
  if (kind === 'resume' && !starts) return KINDS.resume
  if (kind !== 'resume' && KINDS[kind]) return KINDS[kind]
  if (kind === 'none') {
    const why = plain(reason)
    return why ? `**not read as an answer** — ${why}` : '**not read as an answer**'
  }
  return '**not read as an answer**'
}

/**
 * PURE. The receipt line.
 * @param {{kind?: string, starts?: string, reason?: string, replyUrl: string, date: string|Date}} input
 */
export function receiptLine({ kind, starts, reason, replyUrl, date } = {}) {
  return `↩️ [Your reply](${plain(replyUrl)}) (${brusselsTime(date)}, Europe/Brussels) was ${readAs({ kind, starts, reason })}.`
}

const BLOCK = /<!-- reply-receipt at=(\S+) -->\n[\s\S]*?\n<!-- \/reply-receipt -->/g

/**
 * PURE. `body` with the receipt block for `line` at its end. An existing block is replaced in
 * place when its `at` is older than this reply's; when it is the same or newer, `body` comes back
 * unchanged. Nothing else in the body changes.
 * @param {string} body
 * @param {string} line
 * @param {string} at the reply's ISO time
 */
export function applyReceipt(body, line, at) {
  const text = String(body ?? '')
  const block = `<!-- reply-receipt at=${new Date(at).toISOString()} -->\n${line}\n<!-- /reply-receipt -->`
  const found = [...text.matchAll(BLOCK)].at(-1)
  if (!found) return `${text}\n\n${block}`
  const old = Date.parse(found[1])
  if (Number.isFinite(old) && old >= Date.parse(at)) return text
  return text.slice(0, found.index) + block + text.slice(found.index + found[0].length)
}

async function main(env = process.env) {
  const { GH_TOKEN, GITHUB_REPOSITORY, COMMENT_ID, KIND, STARTS: starts, REASON, REPLY_URL, REPLY_AT } = env
  if (!GH_TOKEN || !GITHUB_REPOSITORY || !COMMENT_ID || !REPLY_AT) {
    console.log('receipt: skipped — missing GH_TOKEN, GITHUB_REPOSITORY, COMMENT_ID or REPLY_AT')
    process.exitCode = 1
    return
  }
  const url = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${GITHUB_REPOSITORY}/issues/comments/${COMMENT_ID}`
  const headers = { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const got = await fetch(url, { headers })
  if (!got.ok) throw new Error(`GET comment ${COMMENT_ID}: HTTP ${got.status}`)
  const { body } = await got.json()
  const line = receiptLine({ kind: KIND, starts, reason: REASON, replyUrl: REPLY_URL, date: REPLY_AT })
  const next = applyReceipt(body, line, REPLY_AT)
  if (next === body) return console.log(`receipt: comment ${COMMENT_ID} unchanged (a newer reply already has its receipt)`)
  const put = await fetch(url, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: next }) })
  if (!put.ok) throw new Error(`PATCH comment ${COMMENT_ID}: HTTP ${put.status}`)
  console.log(`receipt: comment ${COMMENT_ID} updated — ${line}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.log(`receipt: failed — ${e?.message || e}`)
    process.exitCode = 1
  })
}
