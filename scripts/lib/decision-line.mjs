// decision-line.mjs — turn an owner's `Decision:` comment into a line of the ticket's
// `## Decisions` section (#3054). Pure and Node-core-only; record-decision.yml does the edit.
//
// Recognised by FORMAT, no interpretation: a comment by the owner (OWNER/MEMBER/COLLABORATOR — the owner's own account) whose first
// non-quote line starts with `Decision:` — or `ok: <reason>` on a held plan. An agent comment
// (🤖 header) counts only when its header says "owner decision". Append-only and idempotent:
// a comment already linked in the section is never added twice.

import { stripGeneratedTrailer } from '../comment-command.mjs'

const OWNERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const DECISION = /^\s*decision:\s*/i
const OK_REASON = /^\s*ok:\s*(?=\S)/i
const NOT_OK = /^\s*not\s+ok:\s*(?=\S)/i
// owner's answer relayed from an agent account: "posted from `@x`'s account (not Maarten) · _Maarten's answer…_"
const RELAYED = /posted from [^_]*account \(not [^)]+\)\s*·\s*_[^_]*\b(?:answer|decisions?)\b/iu

/** The prefix pattern the line starts with (`ok:` / `not ok:` only on a held plan), or null. */
function matchPrefix(line, held) {
  if (DECISION.test(line)) return DECISION
  if (!held) return null
  return [OK_REASON, NOT_OK].find(r => r.test(line)) || null
}

/** @returns {string|null} the decision text (single line, verbatim words), or null */
export function parseDecision({ body, authorAssociation, userType, held = false } = {}) {
  if (userType === 'Bot' || !OWNERS.has(authorAssociation)) return null
  const lines = stripGeneratedTrailer(String(body || '')).split('\n')
  const header = lines.find(l => l.trim())
  const isAgent = /^\s*(?:>\s*)?🤖/u.test(header || '')
  if (isAgent && !/owner decision/i.test(header) && !RELAYED.test(header)) return null
  const rest = lines.filter(l => !/^\s*>/.test(l))
  const first = rest.findIndex(l => l.trim())
  if (first < 0) return null
  const re = matchPrefix(rest[first], held)
  if (!re) return null
  const text = [rest[first].replace(re, ''), ...rest.slice(first + 1)].join(' ').replace(/\s+/g, ' ').trim()
  return text || null
}

/** `- 2026-10-29 · <text> · [comment](<url>)` */
export function decisionLine({ text, date, url }) {
  return `- ${String(date).slice(0, 10)} · ${text} · [comment](${url})`
}

/** Append `line` under `## Decisions` (created if missing). Returns the body unchanged if `url` is already there. */
export function appendDecision(issueBody, line, url) {
  const body = String(issueBody || '')
  const m = /^## Decisions[ \t]*$/m.exec(body)
  if (m && body.slice(m.index).split(/^## /m)[1]?.includes(`](${url})`)) return body
  if (!m) return `${body.replace(/\s+$/, '')}\n\n## Decisions\n${line}\n`
  const start = m.index + m[0].length
  const next = body.slice(start).search(/^## /m)
  const end = next < 0 ? body.length : start + next
  const section = body.slice(start, end).replace(/\s+$/, '')
  return `${body.slice(0, start)}${section}\n${line}\n${end < body.length ? '\n' : ''}${body.slice(end)}`
}
