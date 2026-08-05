#!/usr/bin/env node
/**
 * Harness stage resolver — epic #952 / WS2 (#954).
 *
 * Reads the declared stage model (harness.config.mjs) and answers, for any repo path,
 * "what stage is this, and what gates fire here?". WS3 (#955) points the real call
 * sites (the #779 test-first logic, the packages-edit guard hook, the deploy default,
 * task-worker) at these helpers so lifecycle behaviour is config-driven, not hardcoded.
 *
 *   node scripts/harness-stages.mjs                 # print the stage table
 *   node scripts/harness-stages.mjs <path> [path…]  # resolve path(s) → stage + gates
 *   node scripts/harness-stages.mjs --check         # validate the config shape (CI)
 *   node scripts/harness-stages.mjs --json <path> [path…]  # same resolution, JSON on stdout
 *
 * Library API (imported by WS3 call sites + the test):
 *   loadStages()                       → { stages, unstaged }
 *   stageForPath(path, model?)         → { name, stage } (name===null ⇒ unstaged)
 *   gateMode(path, gateId, model?)     → 'on' | 'opt-in' | 'off'
 *   deployTargetForPath(path, model?)  → 'preview'|'staging'|'prod-manual'|'none'
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(ROOT, 'harness.config.mjs')

export const KNOWN_GATES = ['test-first', 'schema-signoff', 'ui-signoff', 'code-review', 'sec']
export const DEPLOY_TARGETS = ['preview', 'staging', 'prod-manual', 'none']

export async function loadStages(configPath = CONFIG) {
  const mod = await import(pathToFileURL(configPath).href)
  const stages = mod.stages || (mod.default && mod.default.stages) || {}
  const unstaged = mod.unstaged || (mod.default && mod.default.unstaged) ||
    { paths: [], gates: [], optionalGates: [], deploy: 'none' }
  return { stages, unstaged }
}

/** Normalise a path to repo-relative, forward-slashed, no leading "./" or "/". */
function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

/**
 * Resolve a path to its stage by LONGEST matching path prefix, so a nested path
 * (pocs/foo/packages-ish/bar) resolves to the deepest declared prefix that matches.
 * Returns { name, stage }; name is null (and stage is `unstaged`) when nothing matches.
 */
export function stageForPath(path, model) {
  const { stages, unstaged } = model
  const p = norm(path)
  let best = null
  let bestLen = -1
  for (const [name, stage] of Object.entries(stages)) {
    for (const prefix of stage.paths || []) {
      const pre = norm(prefix)
      if ((p === pre.replace(/\/$/, '') || p.startsWith(pre)) && pre.length > bestLen) {
        best = { name, stage }
        bestLen = pre.length
      }
    }
  }
  return best || { name: null, stage: unstaged }
}

/** 'on' if the gate is required at this path's stage, 'opt-in' if optional, else 'off'. */
export function gateMode(path, gateId, model) {
  const { stage } = stageForPath(path, model)
  if ((stage.gates || []).includes(gateId)) return 'on'
  if ((stage.optionalGates || []).includes(gateId)) return 'opt-in'
  return 'off'
}

export function deployTargetForPath(path, model) {
  return stageForPath(path, model).stage.deploy || 'none'
}

/** Names of stages whose edits are guarded (shared code needing approval). */
export function editGuardedStages(model) {
  return Object.entries(model.stages).filter(([, s]) => s.editGuard === true).map(([name]) => name)
}

/**
 * True if this path is in an edit-guarded stage. NOTE: the live enforcer is the bash
 * PreToolUse hook (gate-package-edits.sh), which hardcodes `packages/*` to avoid a Node
 * spawn per Edit/Write (#955). This helper is for tooling/tests that want the declarative
 * answer from the config without paying that cost on the hot path.
 */
export function isEditGuarded(path, model) {
  return stageForPath(path, model).stage.editGuard === true
}

/** Validate the config shape. Returns an array of problem strings ([] = valid). */
export function validate(model) {
  const problems = []
  const { stages } = model
  if (!stages || !Object.keys(stages).length) problems.push('no stages declared')
  for (const [name, s] of Object.entries(stages || {})) {
    if (!Array.isArray(s.paths) || !s.paths.length) problems.push(`stage "${name}": paths must be a non-empty array`)
    for (const g of [...(s.gates || []), ...(s.optionalGates || [])]) {
      if (!KNOWN_GATES.includes(g)) problems.push(`stage "${name}": unknown gate "${g}" (known: ${KNOWN_GATES.join(', ')})`)
    }
    const overlap = (s.gates || []).filter((g) => (s.optionalGates || []).includes(g))
    if (overlap.length) problems.push(`stage "${name}": gate(s) both required and optional: ${overlap.join(', ')}`)
    if (s.deploy && !DEPLOY_TARGETS.includes(s.deploy)) problems.push(`stage "${name}": unknown deploy target "${s.deploy}"`)
    if (s.editGuard !== undefined && typeof s.editGuard !== 'boolean') problems.push(`stage "${name}": editGuard must be a boolean`)
  }
  return problems
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const args = process.argv.slice(2)
  const model = await loadStages()

  if (args.includes('--check')) {
    const problems = validate(model)
    if (problems.length) {
      console.error(`✖ harness.config.mjs invalid:`)
      for (const p of problems) console.error(`  - ${p}`)
      process.exit(1)
    }
    console.error(`✓ harness.config.mjs valid (${Object.keys(model.stages).length} stages)`)
    process.exit(0)
  }

  const asJson = args.includes('--json')
  const paths = args.filter((a) => !a.startsWith('--'))
  if (paths.length) {
    if (asJson) {
      const results = paths.map((p) => {
        const { name, stage } = stageForPath(p, model)
        return {
          path: p,
          stage: name,
          deploy: stage.deploy || 'none',
          gates: {
            required: stage.gates || [],
            optIn: stage.optionalGates || [],
          },
          editGuard: stage.editGuard === true,
        }
      })
      console.log(JSON.stringify(paths.length === 1 ? results[0] : results, null, 2))
      process.exit(0)
    }
    for (const p of paths) {
      const { name, stage } = stageForPath(p, model)
      const req = (stage.gates || []).join(', ') || '—'
      const opt = (stage.optionalGates || []).join(', ') || '—'
      console.log(`${p}\n  stage: ${name ?? 'unstaged'}  deploy: ${stage.deploy || 'none'}\n  gates(required): ${req}\n  gates(opt-in):   ${opt}\n`)
    }
    process.exit(0)
  }

  // default: print the stage table
  console.log('Harness stage model (harness.config.mjs)\n')
  for (const [name, s] of Object.entries(model.stages)) {
    console.log(`■ ${name}  → ${s.paths.join(', ')}`)
    console.log(`    deploy: ${s.deploy || 'none'}`)
    console.log(`    gates(required): ${(s.gates || []).join(', ') || '—'}`)
    console.log(`    gates(opt-in):   ${(s.optionalGates || []).join(', ') || '—'}\n`)
  }
}
