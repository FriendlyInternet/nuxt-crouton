/**
 * Parser for the worker's PLAN comment (#2755, epic #2754). A plan run posts ONE issue comment
 * carrying PLAN_MARKER and these `### ` sections, in any order:
 *
 *   Reproduced · Cause · Fix · Files · Test · Docs · Assumptions · Needs owner
 *
 * Rules the parser enforces (a malformed plan is rejected, not waved through):
 *  - the marker and every section are present and non-empty
 *  - `Reproduced` opens with yes/no; "no" needs a concrete reason after it → the run is
 *    labelled `plan:unverified`
 *  - `Needs owner` opens with yes/no
 *  - `Assumptions` is either the single line "none", or a list of bullets, each carrying
 *      `Why: …`, `Evidence: …` and `Status: verified|unverified`
 *    Evidence of a *verified* assumption must contain a link (https://…) — the proof;
 *    an *unverified* one must say why it could not be checked.
 *
 *  - `Docs` (#3568) is either ONE line `none — <reason>` (bare "none" is rejected), or rows (bullets or
 *    table rows), one per doc claim: `<file:line> "<quote>" — Status: checked|wrong|can't tell —
 *    Evidence: <permalink> — Regression: yes|no — Edit: <edit>` (or `Debt: <why not now>`).
 *    `checked` needs a github.com /blob/<sha>/ permalink as Evidence.
 *
 * Assumption bullet shape (one line each):
 *   - <claim> — Why: <why it is taken as true> — Evidence: <permalink/commit/log/doc> — Status: verified
 *
 * A RE-PLAN (`--revised`, #3149) also needs `### Ticket re-read`: bullets
 *   - <ticket item> — Covered: <where in this plan>   (or `— Not covered: <reason>`)
 * It proves the section was written, not that it is true. First plans are unchanged.
 *
 *   node scripts/lib/plan-shape.mjs [--revised [--fresh]] <comment-body-file>   → JSON verdict on stdout, exit 1 if malformed
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hasMarker } from './marker.mjs'

export const PLAN_MARKER = '<!-- pipeline-plan:v1 -->'
export const SECTIONS = ['Reproduced', 'Cause', 'Fix', 'Files', 'Test', 'Docs', 'Assumptions', 'Needs owner']
// Required only on a re-plan (`--revised`, #3149): proof the planner re-read the ticket.
export const REREAD = 'Ticket re-read'
// #3341: a revision also says what it changed (waived by `--fresh`, a plan started from scratch).
export const CHANGES = 'Changes from the previous plan'

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')

function splitSections(body) {
  const out = {}
  let cur = null
  for (const line of body.split('\n')) {
    const h = line.match(/^#{2,4}\s+\**\s*(.+?)\s*\**\s*$/)
    if (h) {
      cur = [...SECTIONS, REREAD, CHANGES].find((s) => norm(s) === norm(h[1])) || null
      if (cur) out[cur] = ''
      continue
    }
    if (cur) out[cur] += line + '\n'
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim()
  return out
}

const field = (text, key) => {
  const m = text.match(new RegExp(`${key}:\\**\\s*(.*?)(?=\\s+[—–-]+\\s+\\**(?:Why|Evidence|Status):|$)`, 'i'))
  return m ? m[1].replace(/^\**\s*/, '').trim() : ''
}

export function parseAssumptions(text) {
  const errors = []
  const bullets = text.split('\n').map((l) => l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/)).filter(Boolean).map((m) => m[1])
  if (!bullets.length) {
    if (/^\W*none\W*$/i.test(text.trim())) return { items: [], errors }
    return { items: [], errors: ['Assumptions must be bullets, or the single word "none"'] }
  }
  const items = bullets.map((b, i) => {
    const claim = b.split(/\s+[—–-]+\s+\**(?:Why|Evidence|Status):/i)[0].replace(/\*\*/g, '').trim()
    const why = field(b, 'Why')
    const evidence = field(b, 'Evidence')
    const status = field(b, 'Status').toLowerCase().replace(/[^a-z]/g, '')
    const n = `assumption ${i + 1}`
    if (!claim) errors.push(`${n}: no claim`)
    if (!why) errors.push(`${n}: no "Why" (the reason it is taken as true)`)
    if (!evidence) errors.push(`${n}: no "Evidence"`)
    if (status !== 'verified' && status !== 'unverified') errors.push(`${n}: Status must be verified or unverified`)
    if (status === 'verified' && evidence && !/https?:\/\/\S+/.test(evidence)) {
      errors.push(`${n}: a verified assumption needs a linked proof (permalink, commit, run or doc URL)`)
    }
    return { claim, why, evidence, status }
  })
  return { items, errors }
}

const DOC_LABEL = /(?:^|\s+[—–-]+\s+|\s*\|\s*)\**(Status|Evidence|Regression|Edit|Debt):\**\s*/gi
const PERMALINK = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/[0-9a-f]{7,40}\/\S+/

// The text of one docs row, or null for a table separator / header line.
function docRowBody(l, firstTableLine) {
  if (!l.startsWith('|')) return l.replace(/^(?:[-*]|\d+\.)\s+/, '')
  if (/^[\s|:-]+$/.test(l)) return null
  const hasField = /\b(?:Status|Evidence|Regression|Edit|Debt):/i.test(l)
  return firstTableLine && !hasField ? null : l
}

function docRowFields(b) {
  const hits = [...b.matchAll(DOC_LABEL)]
  const claim = (hits.length ? b.slice(0, hits[0].index) : b).replace(/^\|/, '').replace(/\*\*/g, '').replace(/\|\s*$/, '').trim()
  const f = {}
  hits.forEach((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : b.length
    f[h[1].toLowerCase()] = b.slice(h.index + h[0].length, end).replace(/\s*\|\s*$/, '').replace(/\*\*/g, '').trim()
  })
  return { claim, f, status: norm(f.status || ''), regression: norm(f.regression || '') }
}

function docRowErrors({ claim, f, status, regression }, num) {
  const n = `docs row ${num}`
  const errors = []
  if (!claim) errors.push(`${n}: no claim`)
  else if (!/\S+:\d+/.test(claim)) errors.push(`${n}: the claim needs a file:line`)
  if (!['checked', 'wrong', 'canttell'].includes(status)) errors.push(`${n}: Status must be checked, wrong or can't tell`)
  if (status === 'checked' && !PERMALINK.test(f.evidence || '')) errors.push(`${n}: a checked claim needs a github.com /blob/<sha>/ permalink as Evidence`)
  if (regression !== 'yes' && regression !== 'no') errors.push(`${n}: Regression must be yes or no`)
  if (!f.edit && !f.debt) errors.push(`${n}: needs an Edit: (the exact edit) or a Debt: (why not now)`)
  return errors
}

export function parseDocs(text) {
  const t = text.trim()
  const none = t.match(/^\W*none\s*[—–:-]+\s*(\S.{2,})$/i)
  if (none && !t.includes('\n')) return { none: true, rows: [], errors: [] }
  if (/^\W*none\W*$/i.test(t)) return { none: false, rows: [], errors: ['Docs: "none" needs a reason — write "none — <why no doc is touched>"'] }
  const errors = []
  const lines = t.split('\n').map((l) => l.trim()).filter((l) => /^(?:[-*]\s|\d+\.\s|\|)/.test(l))
  const rows = []
  let seenTable = false
  for (const l of lines) {
    const first = l.startsWith('|') && !seenTable
    if (l.startsWith('|')) seenTable = true
    const body = docRowBody(l, first)
    if (body === null) continue
    const row = docRowFields(body)
    errors.push(...docRowErrors(row, rows.length + 1))
    rows.push({ claim: row.claim, status: row.status, evidence: row.f.evidence || '', regression: row.regression, edit: row.f.edit || '', debt: row.f.debt || '' })
  }
  if (!rows.length) errors.push('Docs must be rows (one per doc claim) or one line "none — <reason>"')
  return { none: false, rows, errors }
}

function parseReproduced(text, errors) {
  const m = text.match(/^\W*(yes|no)\b\W*(.*)/is)
  if (!m) { errors.push('Reproduced must open with yes or no'); return null }
  const reproduced = m[1].toLowerCase() === 'yes'
  if (!reproduced && m[2].trim().length < 15) errors.push('Reproduced: no — needs a concrete reason it cannot be reproduced')
  return reproduced
}

function parseNeedsOwner(text, errors) {
  const m = text.match(/^\W*(yes|no)\b/i)
  if (!m) { errors.push('Needs owner must open with yes or no'); return null }
  return m[1].toLowerCase() === 'yes'
}

// `- <ticket item> — Covered: <where in this plan>` or `— Not covered: <reason>`
export function parseReread(text) {
  const errors = []
  const bullets = text.split('\n').map((l) => l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/)).filter(Boolean).map((m) => m[1])
  if (!bullets.length) return { items: [], errors: [`${REREAD} must be bullets: - <ticket item> — Covered: <where> | Not covered: <reason>`] }
  const items = bullets.map((b, i) => {
    const m = b.match(/^(.*?)\s+[—–-]+\s+\**(not covered|covered)\**:\**\s*(.*)$/i)
    if (!m || !m[1].trim() || !m[3].trim()) {
      errors.push(`${REREAD} item ${i + 1}: needs "<ticket item> — Covered: <where>" or "— Not covered: <reason>"`)
      return { item: b, covered: null, note: '' }
    }
    return { item: m[1].replace(/\*\*/g, '').trim(), covered: m[2].toLowerCase() === 'covered', note: m[3].trim() }
  })
  return { items, errors }
}

export function parsePlan(body, { revised = false, fresh = false } = {}) {
  const errors = []
  if (!body.includes(PLAN_MARKER)) errors.push(`missing marker ${PLAN_MARKER}`)
  else if (!hasMarker(body, PLAN_MARKER)) errors.push(`marker ${PLAN_MARKER} must be the first line`)
  const sections = splitSections(body)
  for (const s of SECTIONS) {
    if (!sections[s]) errors.push(`missing or empty section: ${s}`)
  }
  let reread = []
  if (revised) {
    if (!sections[REREAD]) errors.push(`missing or empty section: ${REREAD} (required on a re-plan)`)
    else {
      const r = parseReread(sections[REREAD])
      reread = r.items
      errors.push(...r.errors)
    }
  }
  if (revised && !fresh && !sections[CHANGES]) errors.push(`missing or empty section: ${CHANGES} (required on a re-plan; --fresh waives it)`)
  const reproduced = sections.Reproduced ? parseReproduced(sections.Reproduced, errors) : null
  const needsOwner = sections['Needs owner'] ? parseNeedsOwner(sections['Needs owner'], errors) : null
  const a = sections.Assumptions ? parseAssumptions(sections.Assumptions) : { items: [], errors: [] }
  errors.push(...a.errors)
  const d = sections.Docs ? parseDocs(sections.Docs) : { rows: [], errors: [] }
  errors.push(...d.errors)
  return { ok: errors.length === 0, errors, reproduced, needsOwner, assumptions: a.items, docs: d.rows, reread, unverified: reproduced === false }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const revised = args.includes('--revised')
  const fresh = args.includes('--fresh')
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) { console.error('usage: plan-shape.mjs [--revised [--fresh]] <comment-body-file>'); process.exit(2) }
  const verdict = parsePlan(readFileSync(file, 'utf8'), { revised, fresh })
  console.log(JSON.stringify(verdict))
  process.exit(verdict.ok ? 0 : 1)
}
