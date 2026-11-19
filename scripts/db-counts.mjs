#!/usr/bin/env node
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
 *   node scripts/db-counts.mjs --app velo --env prod --check booking-quantity
 *
 * Discovers the db NAME from the app's wrangler.jsonc (apps/pocs/workers). A real
 * run needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN; --dry-run needs neither.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { resolveAppDb, queryD1Json, isUserTable } from './lib/wrangler-d1.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Named extra read-only checks (`--check <name>`); `none` means no check. */
export const CHECKS = ['booking-quantity']

function setCheck(out, v) {
  if (v === 'none') return
  if (CHECKS.includes(v)) out.check = v
  else {
    console.error(`Unknown --check: ${v}`)
    out.help = true
    out.invalid = true
  }
}

export function parseArgs(argv) {
  const out = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--check') setCheck(out, argv[++i])
    else if (a.startsWith('--check=')) setCheck(out, a.slice(8))
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--app') out.app = argv[++i]
    else if (a === '--env') out.env = argv[++i]
    else if (a.startsWith('--app=')) out.app = a.slice(6)
    else if (a.startsWith('--env=')) out.env = a.slice(6)
    else {
      console.error(`Unknown argument: ${a}`)
      out.help = true
      out.invalid = true
    }
  }
  return out
}

const HELP = `db-counts — row counts for every table in one D1 database (read-only)

Usage:
  node scripts/db-counts.mjs --app <name> --env <env> [--dry-run] [--check <name>]

Options:
  --app <name>   App whose wrangler.jsonc defines the database (apps/pocs/workers)
  --env <env>    Environment: "prod" (top-level config) or any env.<name> (staging, …)
  --dry-run      Print the planned wrangler command and exit; touches nothing
  --check <name>  Extra read-only check after the counts: none (default) | booking-quantity
  -h, --help     Show this help
`

const listTablesSql = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`

/**
 * How many not-cancelled bookings at locations with time slots carry each amount
 * (`quantity`): NULL, 0, 1 or 2+. Fixed SQL — no input reaches it (#4288).
 */
export const BOOKING_QUANTITY_SQL = `SELECT CASE WHEN b.quantity IS NULL THEN 'null' WHEN b.quantity = 0 THEN '0' WHEN b.quantity = 1 THEN '1' ELSE '2+' END AS amount, COUNT(*) AS n
FROM bookings_bookings b JOIN bookings_locations l ON l.id = b.location
WHERE CASE WHEN json_valid(l.slots) AND json_type(l.slots) = 'array' THEN json_array_length(l.slots) ELSE 0 END > 0
  AND b.status <> 'cancelled'
GROUP BY amount ORDER BY amount`

/** Same query for a database still carrying `inventoryMode` (before velo migration 0011): inventory locations are skipped. */
export const BOOKING_QUANTITY_SQL_LEGACY = BOOKING_QUANTITY_SQL.replace(
  "  AND b.status <> 'cancelled'",
  "  AND COALESCE(l.inventoryMode, 0) = 0\n  AND b.status <> 'cancelled'"
)

const locationsTableSql = `SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings_locations'`

/** Pick the legacy query when the bookings_locations CREATE text still has `inventoryMode`. */
export function bookingQuantitySql(locationsTableSql) {
  return String(locationsTableSql ?? '').includes('inventoryMode') ? BOOKING_QUANTITY_SQL_LEGACY : BOOKING_QUANTITY_SQL
}

/** Run the booking-quantity check; `{ missing: true }` when the bookings tables are absent. */
export function runBookingQuantityCheck(tables, query) {
  if (!tables.includes('bookings_bookings') || !tables.includes('bookings_locations')) return { missing: true }
  const createSql = query(locationsTableSql)[0]?.sql
  const chosen = bookingQuantitySql(createSql)
  return { rows: query(chosen), legacy: chosen === BOOKING_QUANTITY_SQL_LEGACY }
}

const AMOUNTS = ['null', '0', '1', '2+']

/** Rows `{ amount, n }` → markdown lines, amounts in the fixed order null, 0, 1, 2+. */
export function formatBookingQuantity(rows) {
  if (!rows?.length) return ['_no slot bookings_']
  const byAmount = new Map(rows.map(r => [String(r.amount), Number(r.n ?? 0)]))
  return [
    '| amount | bookings |',
    '|---|---:|',
    ...AMOUNTS.map(a => `| ${a} | ${byAmount.get(a) ?? 0} |`)
  ]
}

/** One `SELECT COUNT(*)` statement per user table (a single UNION ALL let one bad table sink the report). */
export function planCounts(names) {
  return names.filter(isUserTable).map(t => ({
    table: t,
    sql: `SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`
  }))
}

/** Run one COUNT per table; a failing table is recorded (with its error), not fatal. */
export function countTables(dbName, tables, query) {
  return planCounts(tables).map(({ table, sql }) => {
    try {
      const rows = query(sql)
      return { table, n: Number(rows[0]?.n ?? 0) }
    } catch (err) {
      return { table, n: 0, error: String(err.message).split('\n').slice(0, 6).join(' | ') }
    }
  })
}

/** Throw naming every failed table, so the script still exits 1. */
export function assertNoFailures(results) {
  const failed = results.filter(r => r.error)
  if (failed.length) throw new Error(`${failed.length} table(s) failed: ${failed.map(r => r.table).join(', ')}`)
}

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
    process.exit(args.invalid || !args.help ? 1 : 0)
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
  console.log(`    $ npx wrangler d1 execute ${db.name} --remote --json --command "SELECT COUNT(*) AS n FROM \"<table>\""\n`)

  if (args.dryRun) {
    if (args.check === 'booking-quantity') console.log('  --check booking-quantity: one fixed SELECT on bookings_bookings ⋈ bookings_locations')
    console.log('  --dry-run: no query run.\n')
    return
  }

  const tables = queryD1Json(db.name, listTablesSql, { cwd: repoRoot }).map(r => r.name).filter(isUserTable)
  if (tables.length === 0) {
    console.log('  (no tables)\n')
    writeSummary([`### db-counts — \`${db.name}\` (${args.env})`, '', '_No tables._'])
    return
  }

  const query = (sql) => queryD1Json(db.name, sql, { cwd: repoRoot })
  const results = countTables(db.name, tables, query)
  reportCounts(db, args.env, tables, results)
  if (args.check === 'booking-quantity') reportBookingQuantity(db, args.env, tables, query)
  assertNoFailures(results)
}

/** Print the per-table counts and write them to the run summary. */
function reportCounts(db, env, tables, results) {
  const pad = Math.max(...tables.map(t => t.length), 5)
  let total = 0
  console.log(`  ${'table'.padEnd(pad)}  rows`)
  console.log(`  ${'-'.repeat(pad)}  ----`)
  for (const r of results) {
    total += r.n
    console.log(`  ${r.table.padEnd(pad)}  ${r.error ? `ERROR: ${r.error}` : r.n}`)
  }
  console.log(`  ${'-'.repeat(pad)}  ----`)
  console.log(`  ${'TOTAL'.padEnd(pad)}  ${total}\n`)

  writeSummary([
    `### db-counts — \`${db.name}\` (${env})`,
    '',
    '| table | rows |',
    '|---|---:|',
    ...results.map(r => `| \`${r.table}\` | ${r.error ? `error: ${r.error}` : r.n} |`),
    `| **total** | **${total}** |`
  ])
}

/** Run the booking-quantity check and print/write its table. */
function reportBookingQuantity(db, env, tables, query) {
  const check = runBookingQuantityCheck(tables, query)
  const heading = `### booking-quantity — \`${db.name}\` (${env})`
  if (check.missing) {
    console.log('  no bookings tables\n')
    writeSummary([heading, '', '_no bookings tables_'])
    return
  }
  const lines = formatBookingQuantity(check.rows)
  console.log(`  booking-quantity (slot locations, not cancelled${check.legacy ? ', legacy inventoryMode filter' : ''})`)
  for (const l of lines) console.log(`  ${l}`)
  console.log('')
  writeSummary([heading, '', ...lines])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n  db-counts failed: ${err.message}\n`)
    process.exit(1)
  })
}
