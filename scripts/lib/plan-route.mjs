// layer: harness
/**
 * #2757 (epic #2754) — should a `work-this` issue start in PLAN mode (plan → review → build)?
 *
 * Plan first when ANY of: label `plan-first`; a `type:fix` label; the title/body names a path under
 * `packages/`; or the title/body touches auth / sync / scoped-access / pairing / team-filtered data.
 * Label `no-plan` always wins (the manual skip). Everything else builds directly.
 * The lists live in .claude/plan-routing.json so they can grow without a workflow edit.
 *
 *   node scripts/lib/plan-route.mjs <labels-csv> <issue-file>   → {"mode":"plan"|"build","reason":"…"}
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DEFAULT_CONFIG_PATH = new URL('../../.claude/plan-routing.json', import.meta.url)

export function loadConfig(path = DEFAULT_CONFIG_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** @returns {{ mode: 'plan'|'build', reason: string }} */
export function routeIssue({ labels = [], text = '' }, config = loadConfig()) {
  const has = (l) => labels.includes(l)
  if (has(config.skipPlanLabel)) return { mode: 'build', reason: `label ${config.skipPlanLabel} (manual skip)` }
  if (has(config.forcePlanLabel)) return { mode: 'plan', reason: `label ${config.forcePlanLabel} (forced)` }
  const l = (config.planLabels || []).find(has)
  if (l) return { mode: 'plan', reason: `label ${l}` }
  const pkg = text.match(new RegExp(config.packagePathPattern))
  if (pkg) return { mode: 'plan', reason: `names a shared-package path (${pkg[0]})` }
  for (const p of config.sensitivePatterns || []) {
    const m = text.match(new RegExp(p, 'i'))
    if (m) return { mode: 'plan', reason: `touches auth/sync/team-scoped code (matched "${m[0].trim()}")` }
  }
  return { mode: 'build', reason: 'no bug label, no packages/ path, no auth/sync/team-scoped code' }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [labelsCsv = '', file] = process.argv.slice(2)
  const labels = labelsCsv.split(',').map((s) => s.trim()).filter(Boolean)
  const text = file ? readFileSync(file, 'utf8') : ''
  console.log(JSON.stringify(routeIssue({ labels, text })))
}
