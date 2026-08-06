#!/usr/bin/env node
/**
 * CLI for the PR-preview config rewrite (#2020). Rewrites a BUILT wrangler config in place
 * so the deploy lands in its own Worker with its own D1/KV, then prints the derived names
 * for the workflow to reuse — deploy and migrate must agree on the DB name, and deriving it
 * twice is how they drift.
 *
 *   node scripts/pr-preview-wrangler.mjs <built-wrangler.json> <app> <pr>
 *
 * Emits GITHUB_OUTPUT-style lines on stdout: worker=<name>, db=<database_name>.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { toPrPreview } from './lib/pr-preview-wrangler.mjs'
import { parseJsonc } from './lib/wrangler-d1.mjs'

/** The app's committed config, or null when it can't be read (backfill is then a no-op). */
function readSourceWrangler(appDir) {
  const p = join(appDir, 'wrangler.jsonc')
  if (!existsSync(p)) return null
  try { return parseJsonc(readFileSync(p, 'utf8')) } catch { return null }
}

/** `migrations_dir` for a binding, from the top level or any named env — first match wins. */
function sourceMigrationsDir(source, binding) {
  if (!source) return null
  const scopes = [source, ...Object.values(source.env || {})]
  for (const s of scopes) {
    const hit = (s?.d1_databases || []).find((d) => d.binding === binding && d.migrations_dir)
    if (hit) return hit.migrations_dir
  }
  return null
}

const [file, app, pr] = process.argv.slice(2)
if (!file || !app || !pr) {
  console.error('usage: pr-preview-wrangler.mjs <built-wrangler.json> <app> <pr>')
  process.exit(2)
}

const raw = readFileSync(file, 'utf8')
// cwd is the app root (the workflow runs this with working-directory: <workspace>/<app>), which
// is what a source-config `migrations_dir` is relative to. See absolutizeMigrations (#2078).
const { config, name, changed } = toPrPreview(JSON.parse(raw), app, pr, { migrationsBase: process.cwd() })
writeFileSync(file, JSON.stringify(config, null, 2) + '\n')

// Loud by design: this step silently doing nothing would ship a "preview" pointed at
// staging, which is the exact failure #2020 is about.
for (const c of changed) console.error(`  ${c}`)
if (!changed.length) {
  console.error('pr-preview-wrangler: NOTHING CHANGED — refusing to pretend this is isolated')
  process.exit(1)
}

// The migrate step runs against THIS config, so a D1 binding whose migrations can't be located
// means the preview comes up with an empty schema — green deploy, no tables: the #2078 failure.
//
// Nitro regenerates the built config on every build and is already known to DROP fields the
// source declares (it drops the whole `env` block — nitro#3429, which is why inject-wrangler-env
// exists). Rather than assume `migrations_dir` survives, backfill it from the source
// `wrangler.jsonc` when it's absent, then assert the directory is really there. Backfilling is
// strictly better than failing: it fixes the case instead of blocking every preview on it.
const dbs = config.d1_databases || []
if (dbs.length) {
  const source = readSourceWrangler(process.cwd())
  let patched = false
  for (const b of dbs) {
    if (!b.migrations_dir) {
      const fromSource = sourceMigrationsDir(source, b.binding)
      if (fromSource) {
        b.migrations_dir = resolve(process.cwd(), fromSource)
        console.error(`  d1_databases.${b.binding}: migrations_dir backfilled from wrangler.jsonc = ${b.migrations_dir}`)
        patched = true
      }
    }
    if (!b.migrations_dir) {
      console.error(`pr-preview-wrangler: d1 binding ${b.binding} has NO migrations_dir, in the built config`)
      console.error('  or in wrangler.jsonc. The preview would deploy an unmigrated database (#2078).')
      process.exit(1)
    }
    if (!existsSync(b.migrations_dir)) {
      console.error(`pr-preview-wrangler: migrations_dir does not exist: ${b.migrations_dir}`)
      console.error('  The preview would migrate nothing while reporting success (#138/#2078).')
      process.exit(1)
    }
  }
  if (patched) writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
}

const db = (config.d1_databases || [])[0]?.database_name || ''
console.log(`worker=${name}`)
console.log(`db=${db}`)
