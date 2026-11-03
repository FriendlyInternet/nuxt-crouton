#!/usr/bin/env node
// plan-held.mjs — the owner override the BUILD may trust (#3272).
//
// An owner's `ok: <reason>` on a held plan is re-posted by the Harness App as
// `**Decision (owner override, DATE):** <reason>`. A person's comment can't be trusted by
// authorship rules, so only that bot comment — posted AFTER the newest plan — counts.
// CLI: `gh api .../comments | node scripts/plan-held.mjs --decision` → the decision body, or nothing.

import { pathToFileURL } from 'node:url'

const BOT = 'nuxt-harness[bot]'
const PLAN = '<!-- pipeline-plan:v1 -->'

export function currentOverrideDecision(comments) {
  const list = Array.isArray(comments) ? comments : []
  let planAt = -1
  list.forEach((c, i) => { if (String(c?.body || '').includes(PLAN)) planAt = i })
  for (let i = list.length - 1; i > planAt; i--) {
    const c = list[i]
    if (c?.user?.login === BOT && String(c.body || '').trimStart().startsWith('**Decision (owner override')) return c.body
  }
  return ''
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href && process.argv.includes('--decision')) {
  const { readFileSync } = await import('node:fs')
  const out = currentOverrideDecision(JSON.parse(readFileSync(0, 'utf8') || '[]'))
  if (out) console.log(out)
}
