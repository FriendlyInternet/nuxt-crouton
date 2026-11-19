#!/usr/bin/env node
// worker-question.mjs — post the pi worker's question for it (#4192).
//
// The worker used to post its own `## 🔀 Blocked` comment, so the question carried no reply
// record and the owner's answer was read by its text alone — #3982's relayed "A" was dropped.
// Now the worker writes the question to a file ($RUNNER_TEMP/worker-question.md) and the step
// after `finish` (work-issue-pidev.yml `question`) runs this: it posts the comment, adds
// status:blocked, and — when the worker's `work-<issue>` PR is open and the hold asks for an
// answer — puts a `worker-question` reply record on it, so the owner's first answer starts
// `answer-worker` (a revision of that PR, revise-route.mjs shouldRevise).
//
// Node core + ./reply-record.mjs only. Runs from the full scripts/ copy (`$RUNNER_TEMP/pi-run/scripts`):
// reply-record.mjs imports ../approval.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { recordMarker } from './reply-record.mjs'

const NEEDS = /^\s*\*\*Needs:\*\*\s*(answer|action|approval)\b/i
const HEADER = '> 🤖 **pi.dev harness** · agent pipeline (CI) · _the worker\'s question during the build_'

/**
 * PURE. The question's parts, or null for blank text. `lead` = the first non-blank line with a
 * leading `#…`, `🔀`, `Blocked —` stripped; `needs` = the `**Needs:**` value (default `answer`);
 * `rest` = the remaining lines minus that Needs line.
 * @param {string} text
 * @returns {{lead: string, needs: string, rest: string}|null}
 */
export function parseQuestion(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const at = lines.findIndex((l) => l.trim())
  if (at < 0) return null
  const lead = lines[at].trim().replace(/^#+\s*/, '').replace(/^🔀\s*/u, '').replace(/^Blocked\s*[—–-]\s*/i, '').trim()
  let needs = 'answer'
  const rest = []
  let seen = false
  for (const l of lines.slice(at + 1)) {
    const m = !seen && NEEDS.exec(l)
    if (m) { needs = m[1].toLowerCase(); seen = true; continue }
    rest.push(l)
  }
  return { lead, needs, rest: rest.join('\n').trim() }
}

/**
 * PURE. The comment to post, or null for blank text. `record` is true only when the PR is open
 * and the hold asks for an answer: an `action`/`approval` hold is not a question whose reply
 * should re-run the worker.
 * @param {{text: string, prOpen: boolean, owner?: string}} input
 * @returns {{body: string, record: boolean}|null}
 */
export function questionComment({ text, prOpen, owner = 'pmcp' }) {
  const q = parseQuestion(text)
  if (!q) return null
  const record = Boolean(prOpen) && q.needs === 'answer'
  const o = String(owner || 'pmcp')
  const mention = q.rest.includes(`@${o}`) ? '' : `@${o} `
  const lines = []
  if (record) {
    lines.push(recordMarker({ kind: 'worker-question', question: q.lead.slice(0, 200), accepts: ['other'], starts: { other: 'answer-worker' } }))
  }
  lines.push(HEADER, '', `## 🔀 Blocked — ${q.lead}`, `**Needs:** ${q.needs}`, '', `${mention}${q.rest}`.trim())
  return { body: `${lines.join('\n')}\n`, record }
}

const defaultGh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const defaultFs = { exists: existsSync, readFile: (p) => readFileSync(p, 'utf8'), writeFile: (p, s) => writeFileSync(p, s) }

/**
 * Post the worker's question file on the issue + add status:blocked. No file / blank file →
 * nothing. A failed PR lookup counts as no PR (no record). A failed post or label → exit code 1:
 * losing the question silently is the bug this fixes.
 * @param {{file: string, issue: string|number, owner?: string, gh?: (args: string[]) => string, fs?: typeof defaultFs, log?: (m: string) => void}} input
 * @returns {{posted: boolean, record: boolean, code: number}}
 */
export function postWorkerQuestion({ file, issue, owner, gh = defaultGh, fs = defaultFs, log = (m) => console.log(m) }) {
  const text = file && fs.exists(file) ? fs.readFile(file) : ''
  if (!String(text).trim()) {
    log('no worker question')
    return { posted: false, record: false, code: 0 }
  }
  let prOpen = false
  try {
    prOpen = /^\d+$/.test(String(gh(['pr', 'list', '--head', `work-${issue}`, '--state', 'open', '--json', 'number', '-q', '.[0].number'])).trim())
  } catch {
    prOpen = false
  }
  const c = questionComment({ text, prOpen, owner })
  const out = `${file}.comment.md`
  try {
    fs.writeFile(out, c.body)
    gh(['issue', 'comment', String(issue), '--body-file', out])
  } catch (e) {
    log(`::error::could not post the worker's question on #${issue}: ${e?.message || e}`)
    return { posted: false, record: c.record, code: 1 }
  }
  try {
    gh(['issue', 'edit', String(issue), '--add-label', 'status:blocked'])
  } catch (e) {
    log(`::error::posted the worker's question but could not add status:blocked on #${issue}: ${e?.message || e}`)
    return { posted: true, record: c.record, code: 1 }
  }
  log(`posted the worker's question on #${issue}${c.record ? ' with a reply record' : ' (no reply record)'}`)
  return { posted: true, record: c.record, code: 0 }
}

// CLI: `node worker-question.mjs <file>`, env ISSUE, OWNER_LOGIN.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const r = postWorkerQuestion({ file: process.argv[2], issue: process.env.ISSUE, owner: process.env.OWNER_LOGIN || 'pmcp' })
  process.exit(r.code)
}
