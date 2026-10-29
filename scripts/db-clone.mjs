#!/usr/bin/env node
// layer: stack
/**
 * db-clone.mjs — copy one Cloudflare D1 database into another (full mirror).
 *
 * Generic across the monorepo: it discovers the real D1 database NAMES from each
 * app's `wrangler.jsonc` (apps/<app>, pocs/<app>, or workers/<app>) rather than
 * hardcoding them, so it works for any app and any pair of its environments —
 * `prod ↔ staging ↔ preview`, etc.
 *
 *   node scripts/db-clone.mjs --app velo --from prod --to staging
 *   node scripts/db-clone.mjs --app velo --from staging --to prod   # guarded
 *   node scripts/db-clone.mjs --app velo --from prod --to staging --dry-run
 *
 * What it does (full mirror — the target becomes an exact copy of the source):
 *   1. Resolve source/target db names from wrangler.jsonc.
 *   2. If the TARGET is prod: take a timestamped backup of it first, and require
 *      a typed confirmation (retype the target db name) unless --yes.
 *   3. Export the source DB to SQL.
 *   4. Drop every table in the target, then import the source dump.
 *   5. Print a row/table summary + the backup path.
 *
 * Reading from prod is free (read-only). Writing INTO prod is the dangerous,
 * guarded path. `--dry-run` prints the planned wrangler commands and exits
 * WITHOUT invoking wrangler (and needs no Cloudflare credentials).
 *
 * A real run needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN in the env.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { PROD_ENVS, resolveAppDb, runWrangler, queryD1Json } from './lib/wrangler-d1.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { dryRun: false, yes: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--yes' || a === '-y') out.yes = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--app') out.app = argv[++i]
    else if (a === '--from') out.from = argv[++i]
    else if (a === '--to') out.to = argv[++i]
    else if (a === '--confirm') out.confirm = argv[++i]
    else if (a.startsWith('--app=')) out.app = a.slice(6)
    else if (a.startsWith('--from=')) out.from = a.slice(7)
    else if (a.startsWith('--to=')) out.to = a.slice(5)
    else if (a.startsWith('--confirm=')) out.confirm = a.slice(10)
    else {
      console.error(`Unknown argument: ${a}`)
      out.help = true
    }
  }
  return out
}

const HELP = `db-clone — mirror one Cloudflare D1 database into another

Usage:
  node scripts/db-clone.mjs --app <name> --from <env> --to <env> [--dry-run] [--yes]

Options:
  --app <name>   App whose wrangler.jsonc defines the databases (apps/pocs/workers)
  --from <env>   Source environment: "prod" (top-level config) or any env.<name>
  --to <env>     Target environment (overwritten — becomes an exact copy of source)
  --dry-run      Print the planned wrangler commands and exit; touches nothing
  --confirm <db> Non-interactive prod confirmation: must equal the target db name
                 (use in CI in place of the typed prompt)
  --yes, -y      Skip the typed confirmation when the target is prod (still backs up)
  -h, --help     Show this help

Examples:
  node scripts/db-clone.mjs --app velo --from prod --to staging
  node scripts/db-clone.mjs --app velo --from staging --to prod
  node scripts/db-clone.mjs --app velo --from prod --to staging --dry-run
`

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const wrangler = (args, opts) => runWrangler(args, { cwd: repoRoot, ...opts })

function printCmd(args) {
  console.log(`    $ npx wrangler ${args.join(' ')}`)
}

/** List the db's user tables (so we can drop them for a clean mirror). */
function listTables(dbName) {
  const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  return queryD1Json(dbName, sql, { cwd: repoRoot }).map(r => r.name)
}

function confirmTyped(expected) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`  Type the target db name to confirm overwrite ("${expected}"): `, (answer) => {
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
  if (args.help || !args.app || !args.from || !args.to) {
    console.log(HELP)
    process.exit(args.help ? 0 : 1)
  }

  let source, target
  try {
    source = resolveAppDb(args.app, args.from, repoRoot)
    target = resolveAppDb(args.app, args.to, repoRoot)
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  if (source.name === target.name) {
    console.error(`Source and target resolve to the same database ("${source.name}") — refusing.`)
    process.exit(1)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(repoRoot, '.db-backups')
  const backupPath = join(backupDir, `${target.name}-${stamp}.sql`)
  const dumpPath = join(tmpdir(), `db-clone-${source.name}-${stamp}.sql`)

  const tag = (env, isProd, prodLabel) => (isProd && !PROD_ENVS.has(env) ? `${env}, ${prodLabel}` : env)
  console.log(`\n  db-clone: ${args.app}`)
  console.log(`    source : ${source.name}  (${tag(args.from, source.isProd, 'prod')})`)
  console.log(`    target : ${target.name}  (${target.isProd ? `${args.to}, PROD ⚠` : args.to})  ← overwritten\n`)

  console.log('  Plan (full mirror — wipe target, then import source):')
  if (target.isProd) {
    console.log(`  0. Back up target first:`)
    printCmd(['d1', 'export', target.name, '--remote', '--output', backupPath])
  }
  console.log(`  1. Export source:`)
  printCmd(['d1', 'export', source.name, '--remote', '--output', dumpPath])
  console.log(`  2. Drop every table in target (after listing them).`)
  console.log(`  3. Import source dump into target:`)
  printCmd(['d1', 'execute', target.name, '--remote', '--file', dumpPath])
  console.log('')

  if (args.dryRun) {
    console.log('  --dry-run: no changes made.\n')
    return
  }

  if (target.isProd) {
    console.log('  ⚠  The TARGET is a PRODUCTION database. It will be overwritten.')
    if (!args.yes) {
      let ok
      if (args.confirm !== undefined) {
        // Non-interactive (CI): the provided value must match the target db name.
        ok = args.confirm.trim() === target.name
        if (!ok) console.error(`  --confirm "${args.confirm}" does not match target db name "${target.name}" — aborting.`)
      } else if (process.stdin.isTTY) {
        ok = await confirmTyped(target.name)
        if (!ok) console.error('  Confirmation did not match — aborting.')
      } else {
        ok = false
        console.error(`  Target is prod. In a non-interactive run, pass --confirm "${target.name}" (or --yes) to proceed.`)
      }
      if (!ok) process.exit(1)
    }
    mkdirSync(backupDir, { recursive: true })
    console.log(`  Backing up target → ${backupPath}`)
    wrangler(['d1', 'export', target.name, '--remote', '--output', backupPath])
  }

  console.log(`  Exporting source ${source.name} → ${dumpPath}`)
  wrangler(['d1', 'export', source.name, '--remote', '--output', dumpPath])

  console.log(`  Resetting target ${target.name} …`)
  const tables = listTables(target.name)
  if (tables.length > 0) {
    const dropSql = 'PRAGMA defer_foreign_keys = TRUE;\n'
      + tables.map(t => `DROP TABLE IF EXISTS "${t}";`).join('\n') + '\n'
    const dropPath = join(tmpdir(), `db-clone-drop-${target.name}-${stamp}.sql`)
    writeFileSync(dropPath, dropSql)
    wrangler(['d1', 'execute', target.name, '--remote', '--file', dropPath])
    rmSync(dropPath, { force: true })
    console.log(`    dropped ${tables.length} table(s)`)
  } else {
    console.log('    target had no tables')
  }

  console.log(`  Importing into target ${target.name} …`)
  wrangler(['d1', 'execute', target.name, '--remote', '--file', dumpPath])
  rmSync(dumpPath, { force: true })

  const newTables = listTables(target.name)
  console.log(`\n  ✅ Done. ${target.name} now mirrors ${source.name} (${newTables.length} table(s)).`)
  if (target.isProd) console.log(`     Backup of the overwritten prod db: ${backupPath}`)
  console.log('')
}

main().catch((err) => {
  console.error(`\n  db-clone failed: ${err.message}\n`)
  process.exit(1)
})
