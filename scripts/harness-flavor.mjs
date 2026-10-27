#!/usr/bin/env node
/**
 * Harness flavor resolver — epic #2882 / WS1 (#2884).
 *
 * Prints any key of the declared stack flavor (flavor.config.mjs) so workflows and
 * scripts ask the config instead of carrying inline stack commands.
 *
 *   node scripts/harness-flavor.mjs                    # list the top-level keys
 *   node scripts/harness-flavor.mjs install            # → pnpm install --frozen-lockfile
 *   node scripts/harness-flavor.mjs typecheck.command  # dotted path into a nested key
 *   node scripts/harness-flavor.mjs bot --json         # objects/arrays print as JSON
 *   node scripts/harness-flavor.mjs --check            # validate the config shape (CI)
 *
 * A string prints raw (shell-friendly); anything else prints as JSON. An unknown key
 * exits 1 with the valid keys on stderr — never an empty exit 0 (a no-op that reads as
 * success is the failure shape this resolver must not have).
 *
 * Library API: loadFlavor(), getKey(flavor, 'a.b'), validate(flavor).
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(ROOT, 'flavor.config.mjs')

export const REQUIRED_KEYS = [
  'install', 'warm', 'typecheck', 'testsGate', 'generated', 'bot',
  'labels', 'catalog', 'deploy', 'reviewGates'
]

export async function loadFlavor(configPath = CONFIG) {
  const mod = await import(pathToFileURL(configPath).href)
  return mod.flavor || mod.default || {}
}

/** Resolve a dotted key path. Returns undefined when any segment is missing. */
export function getKey(flavor, key) {
  let cur = flavor
  for (const seg of String(key).split('.')) {
    if (cur === null || typeof cur !== 'object' || !(seg in cur)) return undefined
    cur = cur[seg]
  }
  return cur
}

/** Render a value for stdout: strings raw (unless json), everything else as JSON. */
export function render(value, { json = false } = {}) {
  return typeof value === 'string' && !json ? value : JSON.stringify(value, null, 2)
}

/** Validate the config shape. Returns an array of problem strings ([] = valid). */
export function validate(flavor) {
  const problems = []
  for (const k of REQUIRED_KEYS) if (!(k in (flavor || {}))) problems.push(`missing key "${k}"`)
  if (problems.length) return problems
  if (typeof flavor.install !== 'string' || !flavor.install) problems.push('install must be a non-empty string')
  for (const [path, v] of [
    ['testsGate.logicPaths', flavor.testsGate?.logicPaths],
    ['testsGate.testPaths', flavor.testsGate?.testPaths],
    ['generated.junk', flavor.generated?.junk],
    ['typecheck.appPattern', flavor.typecheck?.appPattern]
  ]) {
    try { new RegExp(v) } catch { problems.push(`${path} is not a valid regex`) }
  }
  if (!flavor.bot?.name || !flavor.bot?.email) problems.push('bot needs name and email')
  for (const [gate, g] of Object.entries(flavor.reviewGates || {})) {
    if (!Array.isArray(g.paths) || !g.paths.length) problems.push(`reviewGates.${gate}: paths must be a non-empty array`)
    if (!g.prompt) problems.push(`reviewGates.${gate}: prompt file required`)
  }
  return problems
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const args = process.argv.slice(2)
  const flavor = await loadFlavor()

  if (args.includes('--check')) {
    const problems = validate(flavor)
    if (problems.length) {
      console.error('✖ flavor.config.mjs invalid:')
      for (const p of problems) console.error(`  - ${p}`)
      process.exit(1)
    }
    console.error(`✓ flavor.config.mjs valid (${Object.keys(flavor).length} keys)`)
    process.exit(0)
  }

  const keys = args.filter((a) => !a.startsWith('--'))
  if (!keys.length) {
    console.log(Object.keys(flavor).join('\n'))
    process.exit(0)
  }
  const value = getKey(flavor, keys[0])
  if (value === undefined) {
    console.error(`unknown flavor key "${keys[0]}" (known: ${Object.keys(flavor).join(', ')})`)
    process.exit(1)
  }
  console.log(render(value, { json: args.includes('--json') }))
}
