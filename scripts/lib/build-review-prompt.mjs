#!/usr/bin/env node
/**
 * Render the build reviewer's prompt (#3196) — replaces the awk+sed one-liner that used to
 * live in build-review.yml, and feeds the reviewer CI's `<!-- plan-checks -->` table so it
 * takes "did each Run: line run and pass on this commit" as FACT instead of re-deriving it.
 *
 *   node scripts/lib/build-review-prompt.mjs <persona.md> --vars <vars.json> \
 *     --comments <pr-comments.json> --sha <head sha> [--outside <outside.json>]   → prompt on stdout
 *
 * `--outside` is scripts/lib/outside-review.mjs's output (#4318): its High findings fill
 * `{{outside_review}}`, and the reviewer must answer each one in `### Outside review`.
 *
 * Runs as a TRUSTED default-branch copy (the working tree is the PR head, #3696), next to a
 * trusted copy of ../pipeline-prompt.mjs. Not pipeline-prompt's renderPrompt: that prepends the
 * operating contract and reads personas from the (PR-head) repo tree; the reviewer gets neither.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { splitFrontmatter } from '../pipeline-prompt.mjs'

const STICKY = '<!-- plan-checks -->'
// Only CI's own comment counts — a human could paste a fake all-✅ table.
const AUTHORS = new Set(['github-actions[bot]', 'nuxt-harness[bot]'])

/** The newest CI plan-checks comment for THIS head sha, else ''. `comments` may be `[[…]]` (gh --slurp). */
export function findChecksTable(comments, sha) {
  const short = String(sha || '').slice(0, 7)
  if (!short) return ''
  const hit = (comments || []).flat()
    .filter((c) => AUTHORS.has(c?.user?.login) && (c.body || '').includes(STICKY) && (c.body || '').includes(`\`${short}\``))
    .pop()
  return hit ? hit.body : ''
}

const RESULT = { '✅': 'pass', '❌': 'fail', '🖐': 'manual' }

/** `| T<n> | what | ✅/❌/🖐 | exit |` rows → [{ id, what, result }]. */
export function parseChecksTable(body) {
  const rows = []
  for (const line of String(body || '').split(/\r?\n/)) {
    const m = line.match(/^\|\s*(T\d+)\s*\|\s*(.*?)\s*\|\s*(✅|❌|🖐)\s*\|[^|]*\|\s*$/)
    if (m) rows.push({ id: m[1], what: m[2].replace(/\\\|/g, '|'), result: RESULT[m[3]] })
  }
  return rows
}

/** The plain-text block that fills `{{plan_checks}}`. */
export function checksBlock(rows) {
  if (!rows || !rows.length) {
    return 'No CI plan-checks table for this commit — judge from the diff and the CI logs whether each Run: line ran, as before.'
  }
  const ids = (r) => rows.filter((x) => x.result === r).map((x) => x.id).join(', ')
  const out = []
  if (ids('pass')) out.push(`CI's plan-checks job ran these Run: lines on this exact commit and every one exited 0 — that is a FACT: ${ids('pass')}. Do not check, and never FAIL item 1 over, whether they ran; judge only whether each test aims at the ticket's rule.`)
  if (ids('manual')) out.push(`Manual lines (CI does not run them; the owner checks them by hand): ${ids('manual')} — name them in item 1's evidence as "owner checks by hand: ${ids('manual')}".`)
  if (ids('fail')) out.push(`CI recorded these as FAILED: ${ids('fail')} — item 1 is FAIL.`)
  return out.join(' ')
}

/** The plain-text block that fills `{{outside_review}}` (#4318). */
export function outsideBlock(outside) {
  const high = outside?.state === 'answered' ? (outside.high || []) : []
  if (!high.length) return 'No High findings from the outside reviewer — leave out `### Outside review`.'
  const list = high.map((h) => `${h.id}: ${h.title}${h.file ? ` (${h.file})` : ''}`).join('; ')
  return `The outside reviewer's High findings on this commit: ${list}. Answer every one in a \`### Outside review\` section: \`- Q<n>: fixed in <commit>\` (a commit on this PR that fixes it) or \`- Q<n>: not a problem because <reason>\`. A go with an unanswered finding is turned into no-go.`
}

/** Persona → prompt: frontmatter stripped, `{{key}}` filled from vars, `{{plan_checks}}` from the table. */
export function renderPrompt(persona, vars = {}, checksBody = '', outside = null) {
  const all = { ...vars, plan_checks: checksBlock(parseChecksTable(checksBody)), outside_review: outsideBlock(outside) }
  return splitFrontmatter(persona).body.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in all ? String(all[k]) : m))
}

const arg = (a, k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }

export function main(argv, { write = (s) => process.stdout.write(s) } = {}) {
  const [persona] = argv
  const varsPath = arg(argv, '--vars')
  if (!persona || !varsPath) throw new Error('usage: build-review-prompt.mjs <persona.md> --vars <vars.json> [--comments <json>] [--sha <sha>] [--outside <json>]')
  const vars = JSON.parse(readFileSync(varsPath, 'utf8'))
  const commentsPath = arg(argv, '--comments')
  const comments = commentsPath ? JSON.parse(readFileSync(commentsPath, 'utf8') || '[]') : []
  const outsidePath = arg(argv, '--outside')
  const outside = outsidePath ? JSON.parse(readFileSync(outsidePath, 'utf8') || 'null') : null
  const prompt = renderPrompt(readFileSync(persona, 'utf8'), vars, findChecksTable(comments, arg(argv, '--sha')), outside)
  write(prompt)
  return prompt
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exit(1) }
}
