#!/usr/bin/env node
// flow-checklist.mjs — ONE bot comment per ticket, edited in place, showing where it is (#3210).
// The first unticked line is the answer to "where is this ticket?".
//
//   node scripts/flow-checklist.mjs <issue> <step> [--link URL] [--note TEXT]
//
// State lives in the comment itself (a ticked line carries its note/link), so concurrent
// events only need the per-issue concurrency group in the workflow. Never touches the issue body.
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

export const STEPS = [
  ['routed', 'Routed'],
  ['plan', 'Plan + mockup posted'],
  ['ok', 'Owner ok'],
  ['pr', 'Build PR opened'],
  ['review', 'Build review'],
  ['merged', 'Merged']
]

/** The issue a PR closes, from its body's leading "Closes #N" line (the pipeline's contract). */
export function issueFromPrBody(body = '') {
  const m = body.match(/\bcloses\s+#(\d+)/i)
  return m ? Number(m[1]) : null
}

export const marker = issue => `<!-- flow-checklist:${issue} -->`

/** Parse ticked steps ({key: detail}) out of an existing comment body. */
export function parse(body = '') {
  const state = {}
  for (const [key, label] of STEPS) {
    const m = body.match(new RegExp(`^- \\[x\\] ${label.replace(/[+]/g, "\\$&")}(?: — (.*))?$`, 'm'))
    if (m) state[key] = m[1] || ''
  }
  return state
}

export function render(issue, state) {
  const lines = STEPS.map(([key, label]) =>
    key in state ? `- [x] ${label}${state[key] ? ` — ${state[key]}` : ''}` : `- [ ] ${label}`)
  return [marker(issue), '> 🤖 **pi.dev harness** · ticket flow · _edited in place_', '', ...lines].join('\n')
}

export function tick(body, issue, step, { link, note } = {}) {
  if (!STEPS.some(([k]) => k === step)) throw new Error(`unknown step "${step}"`)
  const state = parse(body)
  state[step] = [note, link].filter(Boolean).join(' · ')
  return render(issue, state)
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input })
}

function main() {
  const [issue, step, ...rest] = process.argv.slice(2)
  const opt = n => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined }
  if (!issue || !step) { console.error('usage: flow-checklist.mjs <issue> <step> [--link U] [--note T]'); process.exit(2) }
  const repo = process.env.GITHUB_REPOSITORY
  const comments = JSON.parse(gh(['api', `repos/${repo}/issues/${issue}/comments?per_page=100`, '--paginate', '--slurp'])).flat()
  const existing = comments.find(c => (c.body || '').includes(marker(issue)))
  const body = tick(existing?.body || '', issue, step, { link: opt('link'), note: opt('note') })
  if (existing) gh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`, '-F', 'body=@-'], body)
  else gh(['api', `repos/${repo}/issues/${issue}/comments`, '-F', 'body=@-'], body)
  console.log(`flow-checklist: ticked "${step}" on #${issue}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
