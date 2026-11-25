#!/usr/bin/env node
/**
 * Hidden-dependency and code-rule hints for the ticket reviewer (#4529).
 *
 * The reviewer only saw a named ticket or a rule written in a code comment if it happened to grep
 * for it. This finds both, so the epic file the reviewer reads carries them as HINTS (never verdicts):
 *   • namedTickets — open tickets a ticket names in its prose that are not on its `Blocked-by:` line
 *     (minus Dedup-checked / Related / Part of / Closes lines, HTML comments, the ticket itself, the
 *     epic, and the parts a `Split out:` line names in its first sentence);
 *   • codeRules — ticket numbers in the comments of the repo files a ticket names.
 *
 *   node scripts/lib/ticket-hints.mjs notes <tickets.json> <subs.json> --epic <n> --root <dir>
 *     → a markdown "## Automatic hint check" block; always exits 0 (the Gather step runs under set -e);
 *     on any error the block says `could not run — <first line of the error>` instead of the lists.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseBlockers } from '../wave-gate.mjs'

export const CAP = 10
export const MAX_LOOKUPS = 10

const REF = /#(\d{3,6})\b/g
const SKIP_PREFIX = /^(dedup-checked|related|part of|closes|blocked-by)\b/i
const SPLIT_PREFIX = /^split(?: out| into)?:/i
const HEADING = /^\s*#{1,6}\s/
const PATH = /(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]+/g

const refsIn = (s) => [...String(s).matchAll(REF)].map((m) => Number(m[1]))

/** Leading markdown noise off a line: bullets, quotes, heading marks, emphasis. */
function stripLead(line) {
  return String(line).replace(/^[\s\-*_>#]+/, '').replace(/^\*\*/, '').replace(/^[\s*_]+/, '')
}

function stripHtmlComments(body) {
  return String(body || '').replace(/<!--[\s\S]*?-->/g, '')
}

/** PURE. The numbers the first sentence of each `Split out:` line names — the split's own parts. */
export function splitParts(body) {
  const out = new Set()
  for (const line of stripHtmlComments(body).split('\n')) {
    const s = stripLead(line)
    if (!SPLIT_PREFIX.test(s)) continue
    const cut = s.indexOf('. ')
    for (const n of refsIn(cut === -1 ? s : s.slice(0, cut))) out.add(n)
  }
  return out
}

/**
 * PURE (given `stateOf`). → [{ n, where: 'sibling'|'outside', state: 'open'|'unknown' }]
 * `siblings`: the epic's sub-issues ({ number, state }); `stateOf(n)`: 'open' | 'closed' | undefined.
 */
export function namedTickets(ticket, { epic, siblings = [], stateOf = () => undefined } = {}) {
  const body = stripHtmlComments(ticket?.body)
  const drop = new Set([Number(ticket?.number), Number(epic), ...parseBlockers(body), ...splitParts(body)])
  const sib = new Map((siblings || []).map((s) => [Number(s.number), String(s.state || '').toLowerCase()]))
  return proseRefs(body).filter((n) => !drop.has(n)).map((n) => classify(n, sib, stateOf)).filter(Boolean)
}

/** The ticket numbers on prose lines — not under a `## Related` heading, not on a skipped line. */
function proseRefs(body) {
  const seen = new Set()
  let inRelated = false
  for (const line of body.split('\n')) {
    if (HEADING.test(line)) inRelated = /^related\b/i.test(stripLead(line))
    else if (!inRelated && !SKIP_PREFIX.test(stripLead(line))) refsIn(line).forEach((n) => seen.add(n))
  }
  return [...seen]
}

/** A named number → its hint, or null when it is closed. */
function classify(n, sib, stateOf) {
  if (sib.has(n)) return sib.get(n) === 'closed' ? null : { n, where: 'sibling', state: 'open' }
  const st = stateOf(n)
  if (st === 'closed') return null
  return { n, where: 'outside', state: st === 'open' ? 'open' : 'unknown' }
}

/** PURE. Repo-relative file paths named in a ticket body (no `..`, no absolute paths). */
export function namedPaths(body) {
  const text = stripHtmlComments(body)
  const out = []
  for (const m of text.matchAll(PATH)) {
    const p = m[0]
    if (m.index > 0 && text[m.index - 1] === '/') continue
    if (p.startsWith('/') || p.split('/').includes('..')) continue
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/** The comment part of a source line, or null when it carries none. */
function commentPart(line) {
  const t = line.trim()
  if (/^(\/\/|\/\*|\*|#|<!--)/.test(t)) return t
  const i = line.indexOf(' // ')
  return i === -1 ? null : line.slice(i + 1).trim()
}

/** Reads files under `root`. → [{ file, line, refs, text }] — a missing file is skipped silently. */
export function codeRules(ticket, { root = '.' } = {}) {
  const base = resolve(root)
  const out = []
  for (const p of namedPaths(ticket?.body)) {
    const abs = resolve(base, p)
    if (abs !== base && !abs.startsWith(base + sep)) continue
    let text
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) continue
      text = readFileSync(abs, 'utf8')
    } catch { continue }
    text.split('\n').forEach((raw, i) => {
      const c = commentPart(raw)
      if (!c) return
      const refs = [...new Set(refsIn(c))]
      if (refs.length) out.push({ file: p, line: i + 1, refs, text: raw.trim() })
    })
  }
  return out
}

function capped(lines) {
  if (!lines.length) return ['- nothing found']
  if (lines.length <= CAP) return lines
  return [...lines.slice(0, CAP), `- … ${lines.length - CAP} more left out`]
}

function ticketLine({ n, where, state }) {
  const w = where === 'sibling' ? 'in this epic' : 'outside this epic'
  return `- #${n} (${w}, ${state === 'open' ? 'open' : 'state unknown'})`
}

/** PURE (given opts). The block appended to the reviewer's epic file. */
export function hintNotes(tickets, opts = {}) {
  const out = ['', '## Automatic hint check', '',
    'Hints, not verdicts: for each ticket below, say per named ticket "dependency" or "mention", and check each code rule against rule 9.']
  const list = Array.isArray(tickets) ? tickets : []
  if (!list.length) out.push('', '- nothing found')
  for (const t of list) {
    const named = namedTickets(t, opts).map(ticketLine)
    const rules = codeRules(t, opts).map((r) => `- ${r.file}:${r.line} — ${r.refs.map((n) => `#${n}`).join(', ')} — \`${r.text.replace(/`/g, "'")}\``)
    out.push('', `### Ticket #${t.number}`, 'Open tickets it names that are not on its Blocked-by line:', ...capped(named),
      'Rules written in the code it names:', ...capped(rules))
  }
  return out.join('\n') + '\n'
}

/** A `gh api` state lookup with a per-run budget; any error or no budget → undefined (state unknown). */
export function ghStateOf({ repo = process.env.GITHUB_REPOSITORY, max = MAX_LOOKUPS, run = execFileSync } = {}) {
  const cache = new Map()
  let used = 0
  return (n) => {
    if (cache.has(n)) return cache.get(n)
    let st
    if (repo && used < max) {
      used++
      try {
        st = String(run('gh', ['api', `repos/${repo}/issues/${n}`, '--jq', '.state'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 })).trim().toLowerCase()
        if (st !== 'open' && st !== 'closed') st = undefined
      } catch { st = undefined }
    }
    cache.set(n, st)
    return st
  }
}

/** The block printed when the check itself failed — never the "nothing found" block, which means it ran. */
export function couldNotRunNotes(err) {
  const first = String(err?.message ?? err ?? 'unknown error').split('\n')[0].trim() || 'unknown error'
  return ['', '## Automatic hint check', '', `could not run — ${first}`].join('\n') + '\n'
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
    throw new Error(`could not read ${file}: ${e.message}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
  const [mode, ticketsFile, subsFile] = args
  try {
    if (mode !== 'notes' || !ticketsFile) throw new Error('usage: ticket-hints.mjs notes <tickets.json> <subs.json> --epic <n> --root <dir>')
    const tickets = readJson(ticketsFile)
    const siblings = subsFile && !subsFile.startsWith('--') ? readJson(subsFile) : []
    console.log(hintNotes(tickets, { epic: flag('--epic'), root: flag('--root') || '.', siblings: Array.isArray(siblings) ? siblings : [], stateOf: ghStateOf() }))
  } catch (e) {
    console.error(`ticket-hints: ${e.message}`)
    console.log(couldNotRunNotes(e))
  }
  process.exit(0)
}
