#!/usr/bin/env node
// flow-checklist.mjs — ONE bot comment per ticket, edited in place, showing where it is (#3210).
// The first unticked line is the answer to "where is this ticket?".
//
//   node scripts/flow-checklist.mjs <issue> <step> [--link URL] [--note TEXT]
//   node scripts/flow-checklist.mjs <issue> [<step>] --verdict <plan|build> <go|no-go|needs-owner> --round N [--route R] [--link URL]
//
// State lives in the comment itself (a ticked line carries its note/link). Never touches the issue body.
// Known limit: no per-issue concurrency group (the callers are 6 workflows with their own groups),
// so two ticks landing in the same second could lose one; steps are minutes apart in practice.
// Plan review is one more caller: its verdict call runs BEFORE plan review starts the next worker
// run, so it does not race that worker's "routed" tick. There is still no retry loop.
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

export const REVIEWS = [['plan', 'Plan review'], ['build', 'Build review']]
export const VERDICTS = ['go', 'no-go', 'needs-owner']

/** True when this verdict hands the ticket to the owner. Mirrors build-review.yml (`[ "$ROUND" -ge 2 ]`)
 *  and plan-review.yml (`ROUTE = hold`). */
export function sentToOwner(kind, verdict, round, route) {
  if (verdict === 'needs-owner') return true
  if (kind === 'build' && verdict === 'no-go' && Number(round) >= 2) return true
  return kind === 'plan' && verdict === 'no-go' && route === 'hold'
}

export function reviewLine(kind, verdict, round, { route, link } = {}) {
  const r = REVIEWS.find(([k]) => k === kind)
  if (!r) throw new Error(`unknown review kind "${kind}"`)
  if (!VERDICTS.includes(verdict)) throw new Error(`unknown verdict "${verdict}"`)
  if (!/^\d+$/.test(String(round))) throw new Error(`bad round "${round}"`)
  return `- ${r[1]} — ${verdict} (round ${round})${sentToOwner(kind, verdict, round, route) ? ' · sent to you' : ''}${link ? ` · ${link}` : ''}`
}

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
  const reviews = {}
  for (const [kind, label] of REVIEWS) {
    const m = body.match(new RegExp(`^- ${label} — .*$`, 'm'))
    if (m) reviews[kind] = m[0]
  }
  if (Object.keys(reviews).length) state.reviews = reviews
  return state
}

export function render(issue, state) {
  const lines = STEPS.map(([key, label]) =>
    key in state ? `- [x] ${label}${state[key] ? ` — ${state[key]}` : ''}` : `- [ ] ${label}`)
  const rev = REVIEWS.map(([k]) => state.reviews?.[k]).filter(Boolean)
  const block = rev.length ? ['**Latest reviews**', ...rev, ''] : []
  return [marker(issue), '> 🤖 **pi.dev harness** · ticket flow · _edited in place_', '', ...block, ...lines].join('\n')
}

export function review(body, issue, kind, verdict, round, { route, link } = {}) {
  const state = parse(body)
  state.reviews = { ...state.reviews, [kind]: reviewLine(kind, verdict, round, { route, link }) }
  return render(issue, state)
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

/** Find-or-create then edit the ticket's single comment. `run` is injectable for tests. */
export function apply({ repo, issue, step, link, note, verdict, createIfMissing = true, run = gh }) {
  if (!step && !verdict) throw new Error('apply needs a step or a verdict')
  const comments = JSON.parse(run(['api', `repos/${repo}/issues/${issue}/comments?per_page=100`, '--paginate', '--slurp'])).flat()
  // Only our own bot comments count: the marker must open the body.
  const existing = comments.find(c => (c.body || '').startsWith(marker(issue)) && (!c.user || c.user.type === 'Bot'))
  if (!existing && !createIfMissing) { console.error(`no checklist comment on #${issue}; skip`); return 'skipped' }
  let body = existing?.body || ''
  if (step) body = tick(body, issue, step, { link, note })
  if (verdict) body = review(body, issue, verdict.kind, verdict.verdict, verdict.round, { route: verdict.route, link })
  if (existing) run(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`, '-F', 'body=@-'], body)
  else run(['api', `repos/${repo}/issues/${issue}/comments`, '-F', 'body=@-'], body)
  return existing ? 'edited' : 'created'
}

function main() {
  const [issue, ...args] = process.argv.slice(2)
  const step = args[0] && !args[0].startsWith('--') ? args[0] : undefined
  const rest = step ? args.slice(1) : args
  const opt = n => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined }
  const vi = rest.indexOf('--verdict')
  if (!issue || (!step && vi < 0)) {
    console.error('usage: flow-checklist.mjs <issue> [<step>] [--link U] [--note T] [--verdict <plan|build> <verdict> --round N [--route R]]')
    process.exit(2)
  }
  const verdict = vi >= 0 ? { kind: rest[vi + 1], verdict: rest[vi + 2], round: opt('round'), route: opt('route') } : undefined
  const out = apply({ repo: process.env.GITHUB_REPOSITORY, issue, step, link: opt('link'), note: opt('note'), verdict, createIfMissing: !!step })
  console.log(`flow-checklist: ${out === 'skipped' ? 'skipped' : `${step ? `ticked "${step}"` : ''}${step && verdict ? ' + ' : ''}${verdict ? `verdict ${verdict.kind} ${verdict.verdict}` : ''}`} on #${issue}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
