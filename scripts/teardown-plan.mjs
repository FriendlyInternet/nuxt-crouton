/**
 * #2863 — the DECISION half of auto-teardown (epic #2858): given what a merge deleted, which
 * Cloudflare app, database and storage must go. Pure — no Cloudflare, no git, no fs — so every
 * rule is unit-tested (scripts/teardown-plan.test.mjs). The workflow supplies the facts.
 *
 *   planTeardown({ deletedPaths, remainingPaths, configsByApp }) → [{ app, kind, envs, worker, d1, kvTitle, kvId, notes }]
 *   branchMatchesApp(branch, app) → boolean
 *
 * `configsByApp[app]` is the app's LAST wrangler.jsonc before deletion, either parsed or as raw
 * JSONC text. Names come from it; the crouton naming convention is only the fallback when no
 * config exists.
 */
import { parseJsonc } from './lib/wrangler-d1.mjs'

const ROOTS = { pocs: 'poc', apps: 'app' }

/** `pocs/foo/x/y` → { root: 'pocs', app: 'foo' }; anything else → null. */
function appOf(path) {
  const m = /^(pocs|apps)\/([^/]+)\/./.exec(String(path))
  return m ? { root: m[1], app: m[2] } : null
}

function loadConfig(raw) {
  if (!raw) return null
  if (typeof raw !== 'string') return raw
  try {
    return parseJsonc(raw)
  } catch {
    return null
  }
}

/** One env's resource names: real config values win, the convention fills gaps. */
function scopeFor(app, kind, env, config) {
  const isBase = kind === 'poc' || env === 'prod'
  const worker = isBase ? app : `${app}-staging`
  const block = isBase ? config : config?.env?.staging
  return {
    env,
    worker: isBase ? (config?.name || worker) : worker,
    d1: block?.d1_databases?.[0]?.database_name || `${worker}-db`,
    kvTitle: `${worker}-kv`,
    kvId: block?.kv_namespaces?.[0]?.id ?? null,
  }
}

/** Apps touched by the deletion that are gone for good (not still present, not moved under another root). */
function goneApps(deletedPaths, remainingPaths) {
  const touched = new Map() // "root/app" → { root, app }
  for (const p of deletedPaths) {
    const a = appOf(p)
    if (a) touched.set(`${a.root}/${a.app}`, a)
  }
  const stillThere = new Set()
  const nameStillThere = new Set() // same app name under ANY root (a move = promotion)
  for (const p of remainingPaths) {
    const a = appOf(p)
    if (!a) continue
    stillThere.add(`${a.root}/${a.app}`)
    nameStillThere.add(a.app)
  }
  return [...touched.values()].filter(({ root, app }) => !stillThere.has(`${root}/${app}`) && !nameStillThere.has(app))
}

export function planTeardown({ deletedPaths = [], remainingPaths = [], configsByApp = {} } = {}) {
  const plan = []
  for (const { root, app } of goneApps(deletedPaths, remainingPaths)) {
    const kind = ROOTS[root]
    const config = loadConfig(configsByApp[app])
    // A POC has one deploy at the base name. A launched app is staging only: production is manual.
    const envs = ['staging']
    const notes = []
    if (kind === 'app') notes.push('Production is not touched. Remove it by hand with teardown-app.yml (typed confirm).')
    if (!config) notes.push('No wrangler.jsonc found — names follow the crouton naming convention.')
    for (const env of envs) {
      const { worker, d1, kvTitle, kvId } = scopeFor(app, kind, env, config)
      plan.push({ app, kind, envs: [env], worker, d1, kvTitle, kvId, notes })
    }
  }
  return plan
}

/** Exact app name followed by nothing, `-` or `/` — `crouton-builder` never matches `crouton-builder-demo`. */
export function branchMatchesApp(branch, app) {
  if (!branch || !app) return false
  let i = branch.indexOf(app)
  while (i !== -1) {
    const after = branch[i + app.length]
    const before = branch[i - 1]
    // Name must start a token too, so `my-foo` / `foo` isn't confused by a longer prefix word.
    if ((after === undefined || after === '-' || after === '/') && (before === undefined || before === '/' || before === '-')) {
      return true
    }
    i = branch.indexOf(app, i + 1)
  }
  return false
}
