#!/usr/bin/env node
/**
 * #3996 — a chat claims the tickets it drives.
 *
 *   node scripts/claim.mjs claim   <issue> [--name <nick>] [--chat <id>]
 *   node scripts/claim.mjs release <issue> [--chat <id>]
 *   node scripts/claim.mjs who     <issue>
 *   node scripts/claim.mjs chat-id            (reads hook JSON on stdin, prints the short id)
 *
 * The chat id comes from `--chat`, else `$CROUTON_CHAT_ID` (exported by session-start.sh).
 * The nickname comes from `--name`, else `$CROUTON_CHAT_NAME`.
 *
 * A claim is a hidden marker comment + the `claimed` label. A child ticket counts as claimed
 * through its parent epic (up to 3 hops). Decisions live in scripts/lib/chat-claim.mjs; this file
 * only talks to GitHub. `CLAIM_FACTS_FILE=<json>` replaces every GitHub lookup with a fixture
 * (tests and dry runs):
 *   { "issues": { "3988": { "state", "body", "labels", "comments": [{ body, createdAt }], "parent": 3897|null } },
 *     "prs": { "12": { "body", "headRefName" } }, "now": "<iso>" }
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  activeClaim, claimMarker, describeClaim, releaseMarker, shortChatId, sinceStamp,
} from './lib/chat-claim.mjs'

export const MAX_HOPS = 3

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** GitHub-backed facts. Each getter throws on a lookup error (callers decide open/closed). */
export function ghFacts() {
  return {
    now: Date.now(),
    issue(n) {
      const j = JSON.parse(gh(['issue', 'view', String(n), '--json', 'state,body,labels,comments']))
      return {
        state: j.state,
        body: j.body,
        labels: (j.labels || []).map(l => l.name),
        comments: (j.comments || []).map(c => ({ body: c.body, createdAt: c.createdAt })),
      }
    },
    parent(n) {
      try {
        return JSON.parse(gh(['api', `repos/{owner}/{repo}/issues/${n}/parent`])).number || null
      } catch (e) {
        if (/HTTP 404|No parent issue found|Not Found/i.test(`${e.stderr || e.message || e}`)) return null
        throw e
      }
    },
    pr(n) {
      try {
        return JSON.parse(gh(['pr', 'view', String(n), '--json', 'body,headRefName']))
      } catch (e) {
        if (/Could not resolve|no pull requests? found|Not Found/i.test(`${e.stderr || e.message || e}`)) return null
        throw e
      }
    },
  }
}

/** Fixture-backed facts (CLAIM_FACTS_FILE). */
export function fixtureFacts(file) {
  const f = JSON.parse(readFileSync(file, 'utf8'))
  const issues = f.issues || {}
  return {
    now: f.now ? Date.parse(f.now) : Date.now(),
    issue(n) {
      const i = issues[n]
      if (!i) throw new Error(`fixture: no issue #${n}`)
      return { state: i.state || 'OPEN', body: i.body || '', labels: i.labels || [], comments: i.comments || [] }
    },
    parent: (n) => (issues[n] && issues[n].parent) || null,
    pr: (n) => (f.prs && f.prs[n]) || null,
  }
}

export function loadFacts(env = process.env) {
  return env.CLAIM_FACTS_FILE ? fixtureFacts(env.CLAIM_FACTS_FILE) : ghFacts()
}

/** [{ issue, claim }] for the ticket and its parents (nearest first). `first` = an already-read ticket. */
export function claimChain(facts, ticket, first) {
  const out = []
  let n = ticket
  for (let hop = 0; n && hop <= MAX_HOPS; hop++) {
    const issue = hop === 0 && first ? first : facts.issue(n)
    out.push({ issue: n, claim: activeClaim({ state: issue.state, comments: issue.comments, now: facts.now }) })
    n = facts.parent(n)
  }
  return out
}

function parseArgs(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--name' || a === '--chat') opts[a.slice(2)] = argv[++i]
    else if (a.startsWith('--name=') || a.startsWith('--chat=')) opts[a.slice(2, 6)] = a.slice(7)
    else opts._.push(a)
  }
  return opts
}

const header = (chat, ctx) =>
  `> 🤖 **Claude Code** · interactive agent · chat ${chat} · posted from \`@pmcp\`'s account (not Maarten) · _${ctx}_`

function readStdin() {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

const firstLine = (e) => `${e.stderr || e.message || e}`.trim().split('\n')[0]
const fail = (msg) => { process.stderr.write(msg + '\n'); return 1 }
const withName = (chat, name) => `${chat}${name ? ` (${name})` : ''}`

function cmdChatId() {
  let sid = ''
  try { sid = JSON.parse(readStdin() || '{}').session_id || '' } catch { /* no id */ }
  const id = shortChatId(sid)
  if (id) process.stdout.write(id + '\n')
  return 0
}

function cmdWho({ n, chain }) {
  process.stdout.write(describeClaim(n, chain) + '\n')
  return 0
}

function cmdClaim({ n, chain, chat, facts, opts, env }) {
  const held = chain.find(c => c.claim)
  if (held && held.claim.chat !== chat) return fail(`Refused: #${n} is ${describeClaim(n, chain)} — ask the owner.`)
  const name = opts.name || env.CROUTON_CHAT_NAME || ''
  const body = [
    header(chat, 'claim'),
    '',
    `🪪 Claimed by chat ${withName(chat, name)} — other chats: don't start, unblock or rework this; ask the owner.`,
    '',
    claimMarker({ chat, name, since: sinceStamp(facts.now) }),
  ].join('\n')
  gh(['issue', 'comment', String(n), '--body', body])
  try { gh(['issue', 'edit', String(n), '--add-label', 'claimed']) } catch (e) {
    process.stderr.write(`note: could not add the claimed label: ${firstLine(e)}\n`)
  }
  process.stdout.write(`claimed #${n} for chat ${withName(chat, name)}\n`)
  return 0
}

function cmdRelease({ n, chain, chat }) {
  const held = chain.find(c => c.claim)
  if (held && held.issue === n && held.claim.chat !== chat) {
    return fail(`Refused: #${n} is ${describeClaim(n, chain)}, not by chat ${chat} — ask the owner.`)
  }
  const body = [header(chat, 'release'), '', `🪪 Released by chat ${chat}.`, '', releaseMarker(chat)].join('\n')
  gh(['issue', 'comment', String(n), '--body', body])
  try { gh(['issue', 'edit', String(n), '--remove-label', 'claimed']) } catch { /* label may be absent */ }
  process.stdout.write(`released #${n}\n`)
  return 0
}

const ISSUE_COMMANDS = { who: cmdWho, claim: cmdClaim, release: cmdRelease }
const USAGE = 'usage: claim.mjs claim|release|who <issue> [--name <nick>] [--chat <id>] | chat-id'
const NO_CHAT = 'No chat id: pass --chat <6-hex id> or set CROUTON_CHAT_ID (session-start prints it).'

export function main(argv = process.argv.slice(2), env = process.env) {
  const [cmd, ...rest] = argv
  if (cmd === 'chat-id') return cmdChatId()
  const opts = parseArgs(rest)
  const n = Number(String(opts._[0] || '').replace(/^#/, ''))
  const run = ISSUE_COMMANDS[cmd]
  if (!run || !n) return fail(USAGE)
  const chat = String(opts.chat || env.CROUTON_CHAT_ID || '').toLowerCase()
  if (cmd !== 'who' && !/^[0-9a-f]{6}$/.test(chat)) return fail(NO_CHAT)
  const facts = loadFacts(env)
  return run({ n, chain: claimChain(facts, n), chat, facts, opts, env })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main())
  } catch (e) {
    process.stderr.write(`claim.mjs: ${firstLine(e)}\n`)
    process.exit(1)
  }
}
