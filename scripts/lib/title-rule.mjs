#!/usr/bin/env node
/**
 * The ticket title rule (#4353). A title is a plain sentence the owner reads in a list:
 *   • at most MAX_TITLE characters (an emoji counts as one);
 *   • no area prefix — `velo: …`, `crouton-pages: …`, `fix(crouton-sales): …`, `docs: …`. The
 *     component label already shows the area. A colon LATER in the sentence is fine
 *     ("Failure numbers, step 2: …").
 *
 * The ticket reviewer reads the problems this finds (ticket-review.yml appends `notes` to the epic
 * file) and suggests a better title; ticket-review-actions.mjs renames a go ticket before it starts.
 * A title never affects a verdict.
 *
 *   node scripts/lib/title-rule.mjs notes <tickets.json>   → a markdown "## Automatic title check" block (exit 0)
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MAX_TITLE = 140
export const COMMIT_TYPES = ['feat', 'fix', 'refactor', 'docs', 'test', 'chore', 'perf', 'style', 'ci', 'build']
const PREFIX = /^\s*([A-Za-z0-9_.-]+)(\([^)]*\))?!?:\s/
const LABELS_YML = fileURLToPath(new URL('../../.github/labels.yml', import.meta.url))

/** PURE. The component names in labels.yml: the part after `app:` / `poc:` / `pkg:`, lower-cased. */
export function componentNames(labelsYmlText) {
  const out = new Set()
  for (const m of String(labelsYmlText || '').matchAll(/^\s*-?\s*name:\s*["']?(?:app|poc|pkg):([^"'\s]+)["']?\s*$/gm)) out.add(m[1].toLowerCase())
  return out
}

let cached = null
function repoComponents() {
  if (!cached) cached = componentNames(existsSync(LABELS_YML) ? readFileSync(LABELS_YML, 'utf8') : '')
  return cached
}

/** PURE (given `components`). → { ok, problems: ['too long' | 'prefix'] } */
export function checkTitle(title, { components } = {}) {
  const t = String(title ?? '')
  const names = components || repoComponents()
  const problems = []
  if ([...t].length > MAX_TITLE) problems.push('too long')
  const m = t.match(PREFIX)
  if (m) {
    const word = m[1].toLowerCase()
    if (names.has(word) || COMMIT_TYPES.includes(word)) problems.push('prefix')
  }
  return { ok: problems.length === 0, problems }
}

/** PURE. The block appended to the reviewer's epic file. */
export function titleNotes(tickets, opts = {}) {
  const bad = (tickets || []).map((t) => ({ t, r: checkTitle(t.title, opts) })).filter(({ r }) => !r.ok)
  const lines = bad.length ? bad.map(({ t, r }) => `- #${t.number} "${t.title}" — ${r.problems.join(', ')}`).join('\n') : 'none'
  return `\n## Automatic title check\n\nTitles that break the title rule (at most ${MAX_TITLE} characters, no area or commit-type prefix):\n\n${lines}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, file] = process.argv.slice(2)
  if (mode !== 'notes' || !file) { console.error('usage: title-rule.mjs notes <tickets.json>'); process.exit(2) }
  let tickets = []
  try { tickets = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { console.error(`title-rule: could not read ${file}: ${e.message}`) }
  console.log(titleNotes(tickets))
}
