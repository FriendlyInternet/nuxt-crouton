/**
 * Parser for the worker's PLAN comment (#2755, epic #2754). A plan run posts ONE issue comment
 * carrying PLAN_MARKER and these `### ` sections, in any order:
 *
 *   Reproduced · Cause · Fix · Files · Test · Assumptions · Needs owner
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
 * Assumption bullet shape (one line each):
 *   - <claim> — Why: <why it is taken as true> — Evidence: <permalink/commit/log/doc> — Status: verified
 *
 *   node scripts/lib/plan-shape.mjs <comment-body-file>   → JSON verdict on stdout, exit 1 if malformed
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const PLAN_MARKER = '<!-- pipeline-plan:v1 -->'
export const SECTIONS = ['Reproduced', 'Cause', 'Fix', 'Files', 'Test', 'Assumptions', 'Needs owner']

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '')

function splitSections(body) {
  const out = {}
  let cur = null
  for (const line of body.split('\n')) {
    const h = line.match(/^#{2,4}\s+\**\s*(.+?)\s*\**\s*$/)
    if (h) {
      cur = SECTIONS.find((s) => norm(s) === norm(h[1])) || null
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

export function parsePlan(body) {
  const errors = []
  if (!body.includes(PLAN_MARKER)) errors.push(`missing marker ${PLAN_MARKER}`)
  const sections = splitSections(body)
  for (const s of SECTIONS) {
    if (!sections[s]) errors.push(`missing or empty section: ${s}`)
  }
  let reproduced = null
  if (sections.Reproduced) {
    const m = sections.Reproduced.match(/^\W*(yes|no)\b\W*(.*)/is)
    if (!m) errors.push('Reproduced must open with yes or no')
    else {
      reproduced = m[1].toLowerCase() === 'yes'
      if (!reproduced && m[2].trim().length < 15) errors.push('Reproduced: no — needs a concrete reason it cannot be reproduced')
    }
  }
  let needsOwner = null
  if (sections['Needs owner']) {
    const m = sections['Needs owner'].match(/^\W*(yes|no)\b/i)
    if (!m) errors.push('Needs owner must open with yes or no')
    else needsOwner = m[1].toLowerCase() === 'yes'
  }
  let assumptions = []
  if (sections.Assumptions) {
    const a = parseAssumptions(sections.Assumptions)
    assumptions = a.items
    errors.push(...a.errors)
  }
  return { ok: errors.length === 0, errors, reproduced, needsOwner, assumptions, unverified: reproduced === false }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) { console.error('usage: plan-shape.mjs <comment-body-file>'); process.exit(2) }
  const verdict = parsePlan(readFileSync(file, 'utf8'))
  console.log(JSON.stringify(verdict))
  process.exit(verdict.ok ? 0 : 1)
}
