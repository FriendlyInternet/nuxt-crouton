#!/usr/bin/env node
/**
 * resolve-pipeline-model — the read side of the pi pipeline's LIVE model knob (#2161).
 *
 * WHY this exists. The model each pi lane runs was hardcoded in every workflow's `PI_MODEL`
 * expression, so switching models meant editing several workflows by hand — and it drifted
 * (the #2160 stale opus-4-6). Now the models live in ONE editable file, `.claude/pipeline-
 * models.json`, and the workflows read it through this resolver. Edit the JSON → the next
 * dispatch runs on the new model, no workflow change.
 *
 * PURE CORE + THIN CLI, so the resolution rule is unit-tested without the fs:
 *   resolveModel(config, tier)  — 'default' | 'hard' → the model id from the config.
 * The CLI reads .claude/pipeline-models.json (repo-relative to cwd — the checkout root in CI
 * and the repo root locally) and prints the model. On ANY failure it exits non-zero and prints
 * nothing to stdout, so the caller's `|| echo <fallback>` decides the safe default VISIBLY in
 * the workflow rather than a broken empty PI_MODEL reaching pi.
 *
 *   node scripts/resolve-pipeline-model.mjs default   → prints e.g. claude-sonnet-5
 *   node scripts/resolve-pipeline-model.mjs hard      → prints e.g. claude-opus-4-8
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const VALID_TIERS = ['default', 'hard']

/** PURE. Given the parsed config + a tier, return the model id. Throws on anything unusable. */
export function resolveModel(config, tier) {
  if (!config || typeof config !== 'object') throw new Error('config must be an object')
  if (!VALID_TIERS.includes(tier)) throw new Error(`tier must be one of ${VALID_TIERS.join('|')}, got ${JSON.stringify(tier)}`)
  const model = config[tier]
  if (typeof model !== 'string' || !model.trim()) throw new Error(`no model configured for tier '${tier}'`)
  return model.trim()
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const CONFIG_PATH = '.claude/pipeline-models.json'

function main(argv) {
  const tier = argv[0]
  let config
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch (e) {
    console.error(`resolve-pipeline-model: cannot read ${CONFIG_PATH}: ${e.message}`)
    process.exit(1)
  }
  try {
    process.stdout.write(resolveModel(config, tier))
  } catch (e) {
    console.error(`resolve-pipeline-model: ${e.message}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
