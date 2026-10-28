#!/usr/bin/env node
// layer: stack
/**
 * db-counts.mjs — print row counts for every table in one Cloudflare D1 database.
 *
 * READ-ONLY: it only runs SELECTs — nothing is written, dropped, or overwritten.
 * The safe way to *check* what's in a database (e.g. "are velo's imported users
 * and bookings still in staging?") before deciding whether to clone/restore.
 *
 *   node scripts/db-counts.mjs --app velo --env staging
 *   node scripts/db-counts.mjs --app velo --env prod
 *   node scripts/db-counts.mjs --app velo --env staging --dry-run
 *
 * Discovers the db NAME from the app's wrangler.jsonc (apps/pocs/workers). A real
 * run needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN; --dry-run needs neither.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { resolveAppDb, queryD1Json } from './lib/wrangler-d1.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const out = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--app') out.app = argv[++i]
    else if (a === '--env') out.env = argv[++i]
    else if (a.startsWith('--app=')) out.app = a.slice(6)
    else if (a.startsWith('--env=')) out.env = a.slice(6)
    else {
      console.error(`Unknown argument: ${a}`)
      out.help = true
    }
  }
  return out
}

const HELP = `db-counts — row counts for every table in one D1 database (read-only)

Usage:
  node scripts/db-counts.mjs --app <name> --env <env> [--dry-run]

Options:
  --app <name>   App whose wrangler.jsonc defines the database (apps/pocs/workers)
  --env <env>    Environment: "prod" (top-level config) or any env.<name> (staging, …)
  --dry-run      Print the planned wrangler command and exit; touches nothing
  -h, --help     Show this help
`

const listTablesSql = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`

/** Append a markdown table to GITHUB_STEP_SUMMARY when running in Actions. */
function writeSummary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (!file) return
  try {
    appendFileSync(file, lines.join('\n') + '\n')
  } catch { /* best-effort */ }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.app || !args.env) {
    console.log(HELP)
    process.exit(args.help ? 0 : 1)
  }

  let db
  try {
    db = resolveAppDb(args.app, args.env, repoRoot)
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

  console.log(`\n  db-counts: ${args.app} / ${args.env} → ${db.name}${db.isProd ? '  (prod)' : ''}\n`)
  console.log('  Read-only — runs SELECT COUNT(*) per table:')
  console.log(`    $ npx wrangler d1 execute ${db.name} --remote --json --command "<list tables>"`)
  console.log(`    $ npx wrangler d1 execute ${db.name} --remote --json --command "SELECT COUNT(*) … UNION ALL …"\n`)

  if (args.dryRun) {
    console.log('  --dry-run: no query run.\n')
    return
  }

  const tables = queryD1Json(db.name, listTablesSql, { cwd: repoRoot }).map(r => r.name)
  if (tables.length === 0) {
    console.log('  (no tables)\n')
    writeSummary([`### db-counts — \`${db.name}\` (${args.env})`, '', '_No tables._'])
    return
  }

  // One round-trip: COUNT(*) for every table via UNION ALL.
  const countSql = tables
    .map(t => `SELECT '${t.replace(/'/g, `''`)}' AS tbl, COUNT(*) AS n FROM "${t}"`)
    .join(' UNION ALL ')
  const rows = queryD1Json(db.name, countSql, { cwd: repoRoot })
  const counts = new Map(rows.map(r => [r.tbl, Number(r.n)]))

  const pad = Math.max(...tables.map(t => t.length), 5)
  let total = 0
  console.log(`  ${'table'.padEnd(pad)}  rows`)
  console.log(`  ${'-'.repeat(pad)}  ----`)
  for (const t of tables) {
    const n = counts.get(t) ?? 0
    total += n
    console.log(`  ${t.padEnd(pad)}  ${n}`)
  }
  console.log(`  ${'-'.repeat(pad)}  ----`)
  console.log(`  ${'TOTAL'.padEnd(pad)}  ${total}\n`)

  writeSummary([
    `### db-counts — \`${db.name}\` (${args.env})`,
    '',
    '| table | rows |',
    '|---|---:|',
    ...tables.map(t => `| \`${t}\` | ${counts.get(t) ?? 0} |`),
    `| **total** | **${total}** |`
  ])
}

main().catch((err) => {
  console.error(`\n  db-counts failed: ${err.message}\n`)
  process.exit(1)
})
