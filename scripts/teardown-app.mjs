#!/usr/bin/env node
/**
 * teardown-app.mjs — delete a crouton app's Cloudflare resources (Worker + D1 + KV).
 *
 * The inverse of a `/deploy` bootstrap: where deploy auto-provisions a Worker and
 * its D1 + KV, this removes them. It's the destructive half of the `/remove-app`
 * skill — the part the interactive agent CANNOT do (no Cloudflare creds), so it
 * runs in CI via teardown-app.yml (same pattern as db-clone.yml).
 *
 *   node scripts/teardown-app.mjs --app library-catalog --scope staging --dry-run
 *   node scripts/teardown-app.mjs --app library-catalog --scope staging
 *   node scripts/teardown-app.mjs --app velo --scope both --confirm velo   # prod guarded
 *
 * Scope → which env's resources to remove:
 *   staging  → Worker <name>-staging, D1 <name>-staging-db, KV <name>-staging-kv
 *   prod     → Worker <name>,         D1 <name>-db,         KV <name>-kv
 *   both     → both of the above (prod half is guarded — see below)
 *
 * Resource names come from the app's wrangler.jsonc when it still exists; once the
 * code is deleted they fall back to the crouton naming CONVENTION above (so the
 * reference dogfood — library-catalog, whose code is already gone — still works).
 *
 * Guardrails (mirror db-clone's prod guard):
 *   - `--dry-run` prints the planned wrangler commands and exits WITHOUT invoking
 *     wrangler (needs no Cloudflare credentials) — always run this first.
 *   - Deleting a PROD scope requires a typed confirmation: pass --confirm <name>
 *     (must equal the prod worker name) or the prod half aborts. `pocs/` apps have
 *     no prod scope by convention, so staging teardown is the safe default.
 *
 * A real run needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN in the env (the
 * same token the deploy workflows use — Workers Scripts/D1/KV Edit).
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { findWranglerConfig, isAlreadyGone, parseJsonc, runWrangler } from './lib/wrangler-d1.mjs'
import { readFileSync, existsSync } from 'node:fs'

/** Read a file if it's there; '' when absent (labels.yml is optional context, not a dependency). */
function readIfPresent(p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { dryRun: false, yes: false, scope: 'staging' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--yes' || a === '-y') out.yes = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--app') out.app = argv[++i]
    else if (a === '--scope') out.scope = argv[++i]
    else if (a === '--confirm') out.confirm = argv[++i]
    else if (a.startsWith('--app=')) out.app = a.slice(6)
    else if (a.startsWith('--scope=')) out.scope = a.slice(8)
    else if (a.startsWith('--confirm=')) out.confirm = a.slice(10)
    else {
      console.error(`Unknown argument: ${a}`)
      out.help = true
    }
  }
  return out
}

const HELP = `teardown-app — delete a crouton app's Cloudflare resources (Worker + D1 + KV)

Usage:
  node scripts/teardown-app.mjs --app <name> --scope <staging|prod|both> [--dry-run] [--confirm <name>]

Options:
  --app <name>      App to tear down (matches its wrangler.jsonc name / crouton naming convention)
  --scope <scope>   Which env's resources to delete: staging (default) | prod | both
  --dry-run         Print the planned wrangler deletes and exit; touches nothing, needs no creds
  --confirm <name>  Required to delete a PROD scope: must equal the prod worker name
  --yes, -y         Skip the typed prod confirmation (still only for explicit prod teardown)
  -h, --help        Show this help

Examples:
  node scripts/teardown-app.mjs --app library-catalog --scope staging --dry-run
  node scripts/teardown-app.mjs --app library-catalog --scope staging
  node scripts/teardown-app.mjs --app velo --scope both --confirm velo
`

const SCOPES = new Set(['staging', 'prod', 'both'])

// ---------------------------------------------------------------------------
// resolve resources
// ---------------------------------------------------------------------------

/** Read an app's parsed wrangler.jsonc, or null if its code is already gone. */
function loadWrangler(app) {
  const p = findWranglerConfig(app, repoRoot)
  if (!p) return null
  try {
    return parseJsonc(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Is `app` a POC or a launched app? (#1894)
 *
 * It matters because the two have DIFFERENT deploy shapes: `deploy-pocs.yml` gives a POC exactly
 * ONE worker, at the BASE name, carrying the `<app>.pmcp.dev` route — there is no `-staging`
 * sibling and no production counterpart. Resolving a POC the app way targets a worker that never
 * existed, so the teardown silently no-ops and the site keeps serving (the bookmark-stash case).
 *
 * Pure — the caller supplies the facts. A directory outranks a label (a promoted POC keeps its
 * stale `poc:` label); the label is what survives once the code PR is closed and the dir is gone,
 * which is exactly when teardown runs. Unknown stays UNKNOWN and is treated conservatively.
 */
export function detectAppKind({ app, hasPocDir = false, hasAppDir = false, labelsText = '' } = {}) {
  if (hasAppDir) return 'app'
  if (hasPocDir) return 'poc'
  if (labelsText.includes(`"app:${app}"`)) return 'app'
  if (labelsText.includes(`"poc:${app}"`)) return 'poc'
  return 'unknown'
}

/** Which envs a scope actually expands to. A POC has one deploy, whatever was asked for. */
export function plannedEnvs(kind, scope) {
  if (kind === 'poc') return ['staging']
  return scope === 'both' ? ['staging', 'prod'] : [scope]
}

/**
 * Does this teardown need the typed prod confirmation? A POC has no production to protect, so
 * demanding one there teaches an operator to type prod confirmations as routine — which is the
 * guard defeated. Anything not positively identified as a POC keeps the guard (fail closed).
 */
export function needsProdGuard(kind, scope) {
  if (kind === 'poc') return false
  return scope === 'prod' || scope === 'both'
}

/**
 * Resolve the { worker, d1, kvTitle, kvId } for one env scope. Prefers the real
 * names/ids from wrangler.jsonc; falls back to the crouton naming convention so a
 * teardown still works after the app's code has been deleted.
 */
export function resolveScope(app, env, config, kind = 'unknown') {
  const isPoc = kind === 'poc'
  const isProd = !isPoc && env === 'prod'
  // A POC's single deploy lives at the BASE name — same slot a launched app calls prod.
  const worker = (isProd || isPoc) ? app : `${app}-staging`
  // KV auto-provisions under the title "<worker>-<binding>" (binding is KV) → lowercased.
  const kvTitle = `${worker}-kv`
  let d1 = `${worker}-db`
  let kvId = null

  const block = (isProd || isPoc) ? config : config?.env?.staging
  if (block) {
    const dbName = block.d1_databases?.[0]?.database_name
    if (dbName) d1 = dbName
    kvId = block.kv_namespaces?.[0]?.id ?? null
  }
  return { env, isProd, worker, d1, kvTitle, kvId }
}

// ---------------------------------------------------------------------------
// wrangler wrappers (tolerant — a missing resource is reported, not fatal)
// ---------------------------------------------------------------------------

const wrangler = (args, opts) => runWrangler(args, { cwd: repoRoot, ...opts })

function printCmd(args) {
  console.log(`    $ npx wrangler ${args.join(' ')}`)
}

/** Run a delete, treating "doesn't exist" as a no-op so reruns are idempotent. */
function tryDelete(label, args) {
  try {
    wrangler(args)
    console.log(`    ✓ deleted ${label}`)
    return 'deleted'
  } catch (err) {
    const msg = String(err.message || '')
    if (isAlreadyGone(msg)) {
      console.log(`    – ${label} not found (already gone)`)
      return 'absent'
    }
    console.error(`    ✗ failed to delete ${label}: ${msg}`)
    return 'failed'
  }
}

/** Look up a KV namespace id by its title (the convention is "<worker>-kv"). */
function findKvId(kvTitle) {
  try {
    const out = wrangler(['kv', 'namespace', 'list'], { capture: true })
    const list = JSON.parse(out)
    const hit = list.find(n => String(n.title).toLowerCase() === kvTitle.toLowerCase())
    return hit?.id ?? null
  } catch (err) {
    console.error(`    ! could not list KV namespaces: ${err.message}`)
    return null
  }
}

function confirmTyped(expected) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`  Type the prod worker name to confirm teardown ("${expected}"): `, (answer) => {
      rl.close()
      resolve(answer.trim() === expected)
    })
  })
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.app || !SCOPES.has(args.scope)) {
    if (args.scope && !SCOPES.has(args.scope)) console.error(`Invalid --scope "${args.scope}" (use staging | prod | both)\n`)
    console.log(HELP)
    process.exit(args.help ? 0 : 1)
  }

  const config = loadWrangler(args.app)
  const kind = detectAppKind({
    app: args.app,
    hasPocDir: existsSync(join(repoRoot, 'pocs', args.app)),
    hasAppDir: existsSync(join(repoRoot, 'apps', args.app)),
    labelsText: readIfPresent(join(repoRoot, '.github', 'labels.yml')),
  })
  const envs = plannedEnvs(kind, args.scope)
  const scopes = envs.map(env => resolveScope(args.app, env, config, kind))
  const hasProd = needsProdGuard(kind, args.scope)

  console.log(`\n  teardown-app: ${args.app}`)
  console.log(`    source : ${config ? findWranglerConfig(args.app, repoRoot) : 'wrangler.jsonc gone — using crouton naming convention'}`)
  console.log(`    kind   : ${kind}${kind === 'poc' ? ' (one deploy, at the base name — no prod counterpart)' : ''}`)
  console.log(`    scope  : ${args.scope}${kind === 'poc' && args.scope !== 'staging' ? ` → a POC has one env; treating as its single deploy` : ''}\n`)

  // A plan built from a CONVENTION rather than the app's real config is a guess, and a guess
  // that matches nothing exits 0 and reads as success (#1894). Say so loudly, not in passing.
  if (!config) {
    console.log('  ⚠ No wrangler.jsonc found — every name below is INFERRED from the crouton naming')
    console.log('    convention, not read from the app. If the app deployed under different names,')
    console.log('    this plan deletes NOTHING and still reports success. Verify against Cloudflare')
    console.log('    (or the app\'s branch) before trusting a green run.\n')
  }
  if (kind === 'unknown') {
    console.log('  ⚠ Could not tell whether this is a POC or a launched app (no directory, no')
    console.log('    poc:/app: label). Falling back to the launched-app layout and KEEPING the prod')
    console.log('    guard. If it was a POC, its worker is at the base name.\n')
  }

  console.log('  Plan (delete these Cloudflare resources):')
  for (const s of scopes) {
    console.log(`  • ${s.env}${s.isProd ? ' (PROD ⚠)' : ''}:`)
    printCmd(['delete', '--name', s.worker])
    printCmd(['d1', 'delete', s.d1, '-y'])
    printCmd(['kv', 'namespace', 'delete', s.kvId ? `--namespace-id ${s.kvId}` : `(by title "${s.kvTitle}")`])
  }
  console.log('')

  if (args.dryRun) {
    console.log('  --dry-run: no changes made.\n')
    return
  }

  // Prod guard — mirror db-clone: typed confirmation (or --confirm in CI / --yes).
  if (hasProd && !args.yes) {
    const prodWorker = scopes.find(s => s.isProd).worker
    let ok
    if (args.confirm !== undefined) {
      ok = args.confirm.trim() === prodWorker
      if (!ok) console.error(`  --confirm "${args.confirm}" does not match prod worker "${prodWorker}" — aborting.`)
    } else if (process.stdin.isTTY) {
      ok = await confirmTyped(prodWorker)
      if (!ok) console.error('  Confirmation did not match — aborting.')
    } else {
      ok = false
      console.error(`  Scope includes PROD. In a non-interactive run, pass --confirm "${prodWorker}" (or --yes) to proceed.`)
    }
    if (!ok) process.exit(1)
  }

  const results = []
  for (const s of scopes) {
    console.log(`  Tearing down ${s.env} …`)
    results.push(['worker', s.worker, tryDelete(`worker ${s.worker}`, ['delete', '--name', s.worker])])
    results.push(['d1', s.d1, tryDelete(`D1 ${s.d1}`, ['d1', 'delete', s.d1, '-y'])])

    const kvId = s.kvId ?? findKvId(s.kvTitle)
    if (kvId) {
      results.push(['kv', kvId, tryDelete(`KV ${s.kvTitle} (${kvId})`, ['kv', 'namespace', 'delete', '--namespace-id', kvId])])
    } else {
      console.log(`    – KV "${s.kvTitle}" not found (already gone)`)
      results.push(['kv', s.kvTitle, 'absent'])
    }
  }

  const failed = results.filter(r => r[2] === 'failed')
  const deleted = results.filter(r => r[2] === 'deleted')
  console.log(`\n  ${failed.length ? '⚠' : '✅'} Done. ${deleted.length} deleted, ${results.length - deleted.length - failed.length} already gone, ${failed.length} failed.\n`)
  if (failed.length) process.exit(1)
}

// Run only as a CLI — importing this module (e.g. from teardown-app.test.mjs, #1894) must not
// execute a teardown. The decision helpers above are exported for that contract.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(`\n  teardown-app failed: ${err.message}\n`)
    process.exit(1)
  })
}
