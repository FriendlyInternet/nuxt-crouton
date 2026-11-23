#!/usr/bin/env node
/**
 * deploy-order.mjs — pick the order of "deploy the new code" and "migrate the
 * database" for one Cloudflare Workers deploy (#4319, pilot: pocs/pins).
 *
 *   migrate-first  the D1 database already exists (real database_id in the
 *                  chosen scope) → migrate, then deploy. A failed migration
 *                  stops the run, so new code never goes live on an old schema.
 *   deploy-first   first deploy: the database is not created yet (no id) →
 *                  deploy (wrangler auto-provisions it), re-sync ids, migrate.
 *   deploy-only    the scope has no D1 binding → just deploy.
 *
 * Run from the app dir, AFTER `scripts/sync-wrangler-ids.mjs` has written any
 * existing database's id into wrangler.jsonc:
 *
 *   node ../../scripts/deploy-order.mjs [--env <name>] --deploy "<cmd>" \
 *     --migrate "<cmd>" [--resync "<cmd>"] [--config ./wrangler.jsonc]
 *
 * Prints one `deploy order: …` line, runs the steps in order, and exits with
 * the first failing step's status.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseJsonc, PROD_ENVS } from './lib/wrangler-d1.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True only for a non-zero UUID — rejects undefined, '' and placeholders. */
export function isRealDatabaseId(id) {
  return typeof id === 'string' && UUID.test(id) && /[1-9a-f]/i.test(id.replace(/-/g, ''))
}

/**
 * Decide the order for a parsed wrangler config + env name.
 * No env / prod / production → top level; any other env → config.env[env].
 */
export function decideOrder(config, envName) {
  const isProd = !envName || PROD_ENVS.has(envName)
  const scope = isProd ? config : config.env?.[envName]
  if (!scope) {
    const envs = ['prod', ...Object.keys(config.env ?? {})]
    throw new Error(`no environment "${envName}" in wrangler config. Available: ${envs.join(', ')}`)
  }
  const db = scope.d1_databases?.[0]
  if (!db) return { order: 'deploy-only' }
  if (isRealDatabaseId(db.database_id)) return { order: 'migrate-first', database: db.database_name }
  return { order: 'deploy-first', database: db.database_name }
}

/** The one log line that shows which order ran. */
export function orderLine(decision) {
  switch (decision.order) {
    case 'migrate-first': return `deploy order: migrate-first (database ${decision.database} exists)`
    case 'deploy-first': return 'deploy order: deploy-first (first deploy, database not created yet)'
    case 'deploy-only': return 'deploy order: deploy-only (no D1 database)'
    default: throw new Error(`unknown deploy order "${decision.order}"`)
  }
}

/** Ordered command list for an order. `resync` is optional (dropped when empty). */
export function planSteps(order, { deploy, migrate, resync } = {}) {
  switch (order) {
    case 'migrate-first': return [migrate, deploy]
    case 'deploy-first': return [deploy, resync, migrate].filter(Boolean)
    case 'deploy-only': return [deploy]
    default: throw new Error(`unknown deploy order "${order}"`)
  }
}

/** Run steps in turn; stop at the first non-zero status and return it (0 when all pass). */
export function runSteps(steps, exec) {
  for (const step of steps) {
    const status = exec(step)
    if (status !== 0) return status
  }
  return 0
}

export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`)
    const key = a.slice(2)
    if (!['env', 'deploy', 'migrate', 'resync', 'config'].includes(key)) throw new Error(`unknown flag "${a}"`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`flag "${a}" needs a value`)
    out[key] = value
    i++
  }
  return out
}

function main() {
  let steps
  try {
    const args = parseArgs(process.argv.slice(2))
    if (!args.deploy) throw new Error('missing --deploy "<cmd>"')
    if (!args.migrate) throw new Error('missing --migrate "<cmd>"')
    const configPath = args.config ?? './wrangler.jsonc'
    let config
    try {
      config = parseJsonc(readFileSync(configPath, 'utf8'))
    } catch (e) {
      throw new Error(`cannot read wrangler config ${configPath}: ${e.message}`)
    }
    const decision = decideOrder(config, args.env)
    console.log(orderLine(decision))
    steps = planSteps(decision.order, args)
  } catch (e) {
    console.error(`::error::deploy-order: ${e.message}`)
    process.exit(1)
  }
  const status = runSteps(steps, (cmd) => {
    console.log(`deploy-order: $ ${cmd}`)
    return spawnSync(cmd, { shell: true, stdio: 'inherit' }).status ?? 1
  })
  process.exit(status)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
