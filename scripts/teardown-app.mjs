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
 * code is deleted they come from the config at the LAST COMMIT that had the app's
 * folder (git history, #2864). Only if no history exists do they fall back to the
 * crouton naming CONVENTION above — and that is flagged loudly.
 *
 * Safety (#2864): every D1 is exported (`wrangler d1 export`) BEFORE anything is
 * deleted — if an export fails, nothing is deleted. After deleting, each resource is
 * looked up again by exact name; anything still there is "NOT DELETED" and the exit
 * code is non-zero.
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
import { spawnSync } from 'node:child_process'
import { findWranglerConfig, isAlreadyGone, parseJsonc, runWrangler } from './lib/wrangler-d1.mjs'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'

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
    else if (a === '--backup-dir') out.backupDir = argv[++i]
    else if (a.startsWith('--backup-dir=')) out.backupDir = a.slice(13)
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
  --backup-dir <d>  Where D1 exports are written before deletion (default: teardown-backups)
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
 * Pure — the caller supplies the facts. A live directory outranks history (a promoted POC's old
 * history says `pocs/`); `historyKind` is what survives once the code is gone (#2864), read from
 * the path of the app's last commit — never from labels.yml. Unknown stays UNKNOWN and is
 * treated conservatively.
 */
export function detectAppKind({ hasPocDir = false, hasAppDir = false, historyKind = null } = {}) {
  if (hasAppDir) return 'app'
  if (hasPocDir) return 'poc'
  if (historyKind === 'app' || historyKind === 'poc') return historyKind
  return 'unknown'
}

const KIND_DIRS = [['poc', 'pocs'], ['app', 'apps']]

/**
 * Find the app's last life in git history (#2864): the newest commit touching `pocs/<app>/` or
 * `apps/<app>/`, the kind from that path, and the wrangler.jsonc content from that commit (or its
 * parent, when that commit is the deletion). `git(args)` returns stdout or throws — injectable.
 * Returns { kind, sha, path, config } (config null when no parseable wrangler.jsonc) or null.
 */
export function findAppHistory(app, git) {
  let best = null
  for (const [kind, dir] of KIND_DIRS) {
    const prefix = `${dir}/${app}/`
    let out = ''
    try { out = git(['log', '-1', '--format=%H %ct', '--', prefix]).trim() } catch { continue }
    if (!out) continue
    const [sha, ts] = out.split(' ')
    if (!best || Number(ts) > best.ts) best = { kind, sha, ts: Number(ts), dir }
  }
  if (!best) return null
  const path = `${best.dir}/${app}/wrangler.jsonc`
  let config = null
  for (const ref of [best.sha, `${best.sha}^`]) {
    try {
      config = parseJsonc(git(['show', `${ref}:${path}`]))
      break
    } catch { /* not at this ref, or unparseable — try the parent */ }
  }
  return { kind: best.kind, sha: best.sha, path, config }
}

const gitInRepo = args => {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(r.stderr || `git ${args[0]} failed`)
  return r.stdout
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
function tryDelete(label, args, run = wrangler, log = console) {
  try {
    run(args)
    log.log(`    ✓ deleted ${label}`)
    return 'deleted'
  } catch (err) {
    const msg = String(err.message || '')
    if (isAlreadyGone(msg)) {
      log.log(`    – ${label} already gone`)
      return 'absent'
    }
    log.error(`    ✗ failed to delete ${label}: ${msg}`)
    return 'failed'
  }
}

/** Exact-title KV lookup (case-insensitive, never a prefix match). Throws if the list fails. */
export function findKvId(kvTitle, run = wrangler) {
  const list = JSON.parse(run(['kv', 'namespace', 'list'], { capture: true }))
  const hit = list.find(n => String(n.title).toLowerCase() === kvTitle.toLowerCase())
  return hit?.id ?? null
}

/** Is a resource still present? Exact-name matching; throws if the lookup itself fails. */
export function resourceExists(type, s, run = wrangler) {
  if (type === 'd1') {
    return JSON.parse(run(['d1', 'list', '--json'], { capture: true })).some(d => d.name === s.d1)
  }
  if (type === 'kv') {
    const list = JSON.parse(run(['kv', 'namespace', 'list'], { capture: true }))
    return list.some(n => (s.kvId && n.id === s.kvId) || String(n.title).toLowerCase() === s.kvTitle.toLowerCase())
  }
  try {
    run(['deployments', 'list', '--name', s.worker], { capture: true })
    return true
  } catch (err) {
    if (isAlreadyGone(err.message)) return false
    throw err
  }
}

/**
 * Back up, delete, then verify. `run` is the wrangler runner (injectable — tests need no
 * Cloudflare). Returns { aborted, results: [{type, name, status}] } with status
 * deleted | absent | failed | not-deleted.
 *
 * 1. Export EVERY D1 first. An export that fails for any reason except "already gone" aborts
 *    before anything is deleted (case 6).
 * 2. Delete worker, D1, KV; an already-gone resource is "absent", not a failure (case 8).
 * 3. Look each resource up again; one still present is "not-deleted" (case 7). A lookup that
 *    itself errors also counts as not verified → not-deleted, never silently OK.
 */
export function executeTeardown(scopes, { run = wrangler, backupDir = 'teardown-backups', log = console } = {}) {
  const skipD1 = new Set()
  for (const s of scopes) {
    const out = join(backupDir, `${s.d1}.sql`)
    try {
      run(['d1', 'export', s.d1, '--remote', '--output', out])
      log.log(`    ✓ exported D1 ${s.d1} → ${out}`)
    } catch (err) {
      if (isAlreadyGone(err.message)) {
        log.log(`    – D1 ${s.d1} already gone (nothing to back up)`)
        skipD1.add(s.d1)
      } else {
        log.error(`    ✗ could not back up D1 ${s.d1}: ${err.message}\n      Nothing was deleted.`)
        return { aborted: `D1 export failed for ${s.d1}`, results: [] }
      }
    }
  }

  const results = []
  const targets = []
  for (const s of scopes) {
    log.log(`  Tearing down ${s.env} …`)
    results.push({ type: 'worker', name: s.worker, status: tryDelete(`worker ${s.worker}`, ['delete', '--name', s.worker], run, log) })
    targets.push([s, 'worker', s.worker])
    results.push({ type: 'd1', name: s.d1, status: tryDelete(`D1 ${s.d1}`, ['d1', 'delete', s.d1, '-y'], run, log) })
    targets.push([s, 'd1', s.d1])

    let kvId = s.kvId
    try { kvId ??= findKvId(s.kvTitle, run) } catch (err) { log.error(`    ! could not list KV namespaces: ${err.message}`) }
    if (kvId) {
      results.push({ type: 'kv', name: s.kvTitle, status: tryDelete(`KV ${s.kvTitle} (${kvId})`, ['kv', 'namespace', 'delete', '--namespace-id', kvId], run, log) })
    } else {
      log.log(`    – KV ${s.kvTitle} already gone`)
      results.push({ type: 'kv', name: s.kvTitle, status: 'absent' })
    }
    targets.push([{ ...s, kvId }, 'kv', s.kvTitle])
  }

  // Verify: the effect, not the exit code.
  results.forEach((r, i) => {
    if (r.status === 'failed') return
    const [s, type] = targets[i]
    try {
      if (resourceExists(type, s, run)) {
        r.status = 'not-deleted'
        log.error(`    ✗ NOT DELETED: ${type} ${r.name} is still there`)
      }
    } catch (err) {
      r.status = 'not-deleted'
      log.error(`    ✗ NOT DELETED: could not verify ${type} ${r.name}: ${err.message}`)
    }
  })
  return { aborted: null, results }
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

function printBanner({ args, kind, config, liveConfig, history }) {
  const source = liveConfig
    ? findWranglerConfig(args.app, repoRoot)
    : config
      ? `${history.path} @ ${history.sha.slice(0, 8)} (git history)`
      : 'no wrangler.jsonc anywhere — using crouton naming convention'
  console.log(`\n  teardown-app: ${args.app}`)
  console.log(`    source : ${source}`)
  console.log(`    kind   : ${kind}${kind === 'poc' ? ' (one deploy, at the base name — no prod counterpart)' : ''}`)
  console.log(`    scope  : ${args.scope}${kind === 'poc' && args.scope !== 'staging' ? ` → a POC has one env; treating as its single deploy` : ''}\n`)

  // A plan built from a CONVENTION rather than the app's real config is a guess, and a guess
  // that matches nothing exits 0 and reads as success (#1894). Say so loudly, not in passing.
  if (!config) {
    console.log('  ⚠ No wrangler.jsonc found (live or in git history; is the clone shallow?) — every name below is INFERRED from the crouton naming')
    console.log('    convention, not read from the app. If the app deployed under different names,')
    console.log('    this plan deletes NOTHING and still reports success. Verify against Cloudflare')
    console.log('    (or the app\'s branch) before trusting a green run.\n')
  }
  if (kind === 'unknown') {
    console.log('  ⚠ Could not tell whether this is a POC or a launched app (no directory, no')
    console.log('    poc:/app: label). Falling back to the launched-app layout and KEEPING the prod')
    console.log('    guard. If it was a POC, its worker is at the base name.\n')
  }
}

function printPlan(scopes) {
  console.log('  Plan (delete these Cloudflare resources):')
  for (const s of scopes) {
    console.log(`  • ${s.env}${s.isProd ? ' (PROD ⚠)' : ''}:`)
    printCmd(['delete', '--name', s.worker])
    printCmd(['d1', 'delete', s.d1, '-y'])
    printCmd(['kv', 'namespace', 'delete', s.kvId ? `--namespace-id ${s.kvId}` : `(by title "${s.kvTitle}")`])
  }
  console.log('')
}

// Prod guard — mirror db-clone: typed confirmation (or --confirm in CI). Resolves true to proceed.
async function confirmProd(args, prodWorker) {
  if (args.confirm !== undefined) {
    const ok = args.confirm.trim() === prodWorker
    if (!ok) console.error(`  --confirm "${args.confirm}" does not match prod worker "${prodWorker}" — aborting.`)
    return ok
  }
  if (process.stdin.isTTY) {
    const ok = await confirmTyped(prodWorker)
    if (!ok) console.error('  Confirmation did not match — aborting.')
    return ok
  }
  console.error(`  Scope includes PROD. In a non-interactive run, pass --confirm "${prodWorker}" (or --yes) to proceed.`)
  return false
}

/** Print the outcome; returns true when anything was not deleted. */
function reportResults(results) {
  const count = st => results.filter(r => r.status === st).length
  const bad = count('failed') + count('not-deleted')
  for (const r of results.filter(r => r.status === 'not-deleted' || r.status === 'failed')) {
    console.error(`  ✗ NOT DELETED: ${r.type} ${r.name}`)
  }
  console.log(`\n  ${bad ? '⚠' : '✅'} Done. ${count('deleted')} deleted (verified gone), ${count('absent')} already gone, ${count('failed')} failed, ${count('not-deleted')} NOT DELETED.\n`)
  return bad > 0
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.app || !SCOPES.has(args.scope)) {
    if (args.scope && !SCOPES.has(args.scope)) console.error(`Invalid --scope "${args.scope}" (use staging | prod | both)\n`)
    console.log(HELP)
    process.exit(args.help ? 0 : 1)
  }

  const liveConfig = loadWrangler(args.app)
  const history = liveConfig ? null : findAppHistory(args.app, gitInRepo)
  const config = liveConfig ?? history?.config ?? null
  const kind = detectAppKind({
    hasPocDir: existsSync(join(repoRoot, 'pocs', args.app)),
    hasAppDir: existsSync(join(repoRoot, 'apps', args.app)),
    historyKind: history?.kind,
  })
  const envs = plannedEnvs(kind, args.scope)
  const scopes = envs.map(env => resolveScope(args.app, env, config, kind))
  const hasProd = needsProdGuard(kind, args.scope)

  printBanner({ args, kind, config, liveConfig, history })

  printPlan(scopes)

  if (args.dryRun) {
    console.log('  --dry-run: no changes made.\n')
    return
  }

  if (hasProd && !args.yes && !(await confirmProd(args, scopes.find(s => s.isProd).worker))) process.exit(1)

  const backupDir = args.backupDir || 'teardown-backups'
  mkdirSync(backupDir, { recursive: true })
  const { aborted, results } = executeTeardown(scopes, { backupDir })
  if (aborted) {
    console.error(`\n  ✗ Aborted: ${aborted}. Nothing was deleted.\n`)
    process.exit(1)
  }

  if (reportResults(results)) process.exit(1)
}

// Run only as a CLI — importing this module (e.g. from teardown-app.test.mjs, #1894) must not
// execute a teardown. The decision helpers above are exported for that contract.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(`\n  teardown-app failed: ${err.message}\n`)
    process.exit(1)
  })
}
