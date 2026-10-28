#!/usr/bin/env node
// layer: harness
// Guard: keep the event listeners folded (#2893, epic #2889).
//
// Comment, issue-close and PR-close each started 6-9 workflows, 8 of which exited immediately.
// They were folded into on-comment.yml / on-issue-close.yml / on-pr-close.yml; this check stops
// the next ticket growing them back.
//
//   issue_comment            only in on-comment.yml
//   issues: types ⊇ closed   only in on-issue-close.yml
//   pull_request: types ⊇ closed   only in on-pr-close.yml
//
// Deliberate exceptions go in .github/workflow-listeners.allow, one `<file> <rule>` per line
// (`#` starts a comment). Node core only — no YAML parser — relying on the repo's 2-space layout.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const DIR = '.github/workflows'
export const ALLOW_FILE = '.github/workflow-listeners.allow'

export const RULES = {
  'issue_comment': { owner: 'on-comment.yml', what: 'listens for `issue_comment`' },
  'issues-closed': { owner: 'on-issue-close.yml', what: 'listens for `issues: closed`' },
  'pr-closed': { owner: 'on-pr-close.yml', what: 'listens for `pull_request: closed`' },
}

/** Lines under the top-level `on:` key (handles the unquoted and quoted key). */
function onBlock(text) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^["']?on["']?:/.test(l))
  if (start < 0) return { inline: '', body: [] }
  const inline = lines[start].replace(/^["']?on["']?:\s*/, '').replace(/#.*/, '').trim()
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => /^\S/.test(l))
  return { inline, body: end < 0 ? rest : rest.slice(0, end) }
}

/** The `types:` of one event block (inline `[a, b]` or a `- a` list), lower-cased. */
function typesOf(blockLines) {
  const out = []
  for (let i = 0; i < blockLines.length; i++) {
    const m = blockLines[i].match(/^\s+types:\s*(.*)$/)
    if (!m) continue
    const inline = m[1].replace(/#.*/, '').trim()
    if (inline) {
      out.push(...inline.replace(/[[\]'"]/g, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    } else {
      for (const l of blockLines.slice(i + 1)) {
        const item = l.match(/^\s+-\s*['"]?([\w-]+)['"]?/)
        if (!item) break
        out.push(item[1].toLowerCase())
      }
    }
  }
  return out
}

/** The lines belonging to event `name` directly under `on:` (2-space key). */
function eventBlock(body, name) {
  const idx = body.findIndex(l => new RegExp(`^  ${name}:`).test(l))
  if (idx < 0) return null
  const rest = body.slice(idx + 1)
  const end = rest.findIndex(l => /^  \S/.test(l))
  return end < 0 ? rest : rest.slice(0, end)
}

/** Which rules does this workflow text trip? @returns {string[]} rule ids */
export function listenersIn(text) {
  const { inline, body } = onBlock(text)
  const hit = []
  const inlineEvents = inline.replace(/[[\]'"]/g, '').split(',').map(s => s.trim())
  if (inlineEvents.includes('issue_comment') || eventBlock(body, 'issue_comment')) hit.push('issue_comment')
  const issues = eventBlock(body, 'issues')
  // `issues:` with no `types:` fires on every action, closed included.
  if (issues && (typesOf(issues).length === 0 || typesOf(issues).includes('closed'))) hit.push('issues-closed')
  const pr = eventBlock(body, 'pull_request')
  if (pr && typesOf(pr).includes('closed')) hit.push('pr-closed')
  return hit
}

export function parseAllow(text) {
  const set = new Set()
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const [file, rule] = line.split(/\s+/)
    if (file && rule) set.add(`${file} ${rule}`)
  }
  return set
}

/** @returns {string[]} one human-readable violation per offending file/rule */
export function check({ dir = DIR, allowFile = ALLOW_FILE } = {}) {
  const allow = existsSync(allowFile) ? parseAllow(readFileSync(allowFile, 'utf8')) : new Set()
  const violations = []
  for (const f of readdirSync(dir).filter(n => /\.ya?ml$/.test(n)).sort()) {
    for (const rule of listenersIn(readFileSync(join(dir, f), 'utf8'))) {
      const { owner, what } = RULES[rule]
      if (f === owner || allow.has(`${f} ${rule}`)) continue
      violations.push(`${f} ${what}; only ${owner} may (fold it there, or add "${f} ${rule}" to ${ALLOW_FILE} with a reason)`)
    }
  }
  return violations
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = check()
  if (v.length) {
    console.error(v.map(m => `✗ ${m}`).join('\n'))
    process.exit(1)
  }
  console.log('✓ listeners are folded: one comment, one issue-close, one PR-close workflow')
}
