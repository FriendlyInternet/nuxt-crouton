#!/usr/bin/env node
// Capture one real reply as a reply-replay case (#4102). Not run by the tests.
//   node scripts/reply-replay-capture.mjs <issue> <commentId> --want <want> --note "<text>" [--out <file>]
// Needs `gh` logged in; REST only (issues/<n>/comments, issues/<n>/events).
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { todayOutcome, meaningToday, trimBody, labelsAt } from './reply-replay.mjs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { want: { type: 'string' }, note: { type: 'string', default: '' }, out: { type: 'string' } },
})
const [issueArg, idArg] = positionals
if (!issueArg || !idArg || !values.want) {
  console.error('usage: reply-replay-capture.mjs <issue> <commentId> --want <want> --note "<text>" [--out <file>]')
  process.exit(1)
}
const issue = Number(issueArg)
const commentId = Number(idArg)
const repo = process.env.GITHUB_REPOSITORY || 'FriendlyInternet/nuxt-crouton'

function api(path) {
  const out = execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/${path}`], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return JSON.parse(out).flat()
}

const comments = api(`issues/${issue}/comments?per_page=100`)
const events = api(`issues/${issue}/events?per_page=100`)
const reply = comments.find((c) => c.id === commentId)
if (!reply) {
  console.error(`comment ${commentId} not found on #${issue}`)
  process.exit(1)
}
const t = Date.parse(reply.created_at)
const prior = comments
  .filter((c) => {
    const ct = Date.parse(c.created_at)
    return ct < t || (ct === t && c.id < commentId)
  })
  .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
  .map((c) => ({ body: trimBody(c.body), userType: c.user?.type, authorAssociation: c.author_association }))

const c = {
  issue,
  source: reply.html_url,
  labels: labelsAt(events, reply.created_at),
  comments: prior,
  reply: { body: reply.body, authorAssociation: reply.author_association, userType: reply.user?.type, userLogin: reply.user?.login },
  want: values.want,
  today: '',
  note: values.note,
  synthetic: false,
}
c.today = meaningToday(todayOutcome(c))

const out = values.out || fileURLToPath(new URL(`./fixtures/reply-replay/${issue}-${commentId}.json`, import.meta.url))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(c, null, 2) + '\n')
console.log(`${out}: today=${c.today} want=${c.want}`)
