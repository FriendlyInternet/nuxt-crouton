#!/usr/bin/env node
/**
 * Column-level schema diff for migration squashes (#1717).
 *
 * WHY THIS EXISTS: squashing a migration history regenerates the baseline from the
 * SCHEMA SOURCE. A hand-written corrective migration that fixed the DATABASE but was
 * never reflected back into that source is therefore SILENTLY REVERTED by the squash.
 *
 * That is not hypothetical. kassa's `0019_nullable_printer_location` made
 * `sales_printers.locationId` nullable, healing a regression `0016` introduced. The
 * schema source still said `.notNull()`, so the #1455 squash brought the bug straight
 * back — and it was caught only when the production restore died on real data:
 *
 *     NOT NULL constraint failed: sales_printers.locationId
 *
 * A table-NAME diff cannot see this: the table exists on both sides. You have to
 * compare COLUMNS and their constraints.
 *
 * Usage:
 *   node scripts/schema-diff.mjs <old.sql> <new.sql> [--live <dump.sql>] [--json]
 *
 *   <old.sql>   concatenated OLD migration history (cat 0000..NNNN in order)
 *   <new.sql>   the regenerated single baseline
 *   --live      a `wrangler d1 export` dump of the LIVE database. This is the one
 *               that governs a restore — the migration files can drift from reality.
 *
 * Exit codes: 0 = no restore-blocking drift, 1 = drift that will break a restore.
 */
import { readFileSync } from 'node:fs'

/** Split a CREATE TABLE body on top-level commas (nested parens are not separators). */
function splitColumns(body) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else { cur += ch }
  }
  parts.push(cur.trim())
  return parts
}

const CONSTRAINT_LINE = /^(?:FOREIGN|PRIMARY|UNIQUE|CONSTRAINT|CHECK)\b/i

/** `\`col\` text NOT NULL` → ['col', 'text NOT NULL'] (whitespace-normalised). */
function parseColumn(decl) {
  if (CONSTRAINT_LINE.test(decl)) return null
  // Group 2 must start non-whitespace: `\s*(.*)` is ambiguous (both can match spaces)
  // and eslint flags it as super-linear backtracking.
  // `\s+` (not `\s*`) before group 2: \w and \s are disjoint, so the name can't
  // overlap the tail. `\s*` there is ambiguous and eslint flags the backtracking.
  const m = decl.match(/^[`"[]?(\w+)[`"\]]?(?:\s+(\S[\s\S]*))?$/)
  if (!m) return null
  return [m[1], (m[2] || '').split(/\s+/).join(' ').replace(/,$/, '').trim()]
}

const STMT = new RegExp(
  '(CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?[`"[]?\\w+[`"\\]]?\\s*\\([\\s\\S]*?\\);'
  + '|DROP TABLE\\s+(?:IF EXISTS\\s+)?[`"[]?\\w+[`"\\]]?\\s*;'
  + '|ALTER TABLE\\s+[`"[]?\\w+[`"\\]]?\\s+RENAME TO\\s+[`"[]?\\w+[`"\\]]?\\s*;)',
  'gi'
)

/**
 * Replay CREATE/DROP/RENAME so a drizzle table REBUILD resolves to its FINAL shape.
 *
 * Drizzle rebuilds a table as: CREATE __new_x → copy → DROP x → ALTER __new_x RENAME TO x.
 * Without replaying, every rebuilt table reads as a spurious drop plus a stray __new_*.
 * This is exactly how `0019` expressed its fix, so a differ that skips this step is
 * blind to the very case the script exists for.
 *
 * @returns {Record<string, Record<string,string>>} table -> column -> normalised type
 */
export function finalTables(sql) {
  const tables = {}
  for (const [stmt] of sql.matchAll(STMT)) {
    const s = stmt.trim()
    if (/^CREATE/i.test(s)) {
      const name = s.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?[`"[]?(\w+)/i)[1]
      const body = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
      const cols = {}
      for (const decl of splitColumns(body)) {
        const parsed = parseColumn(decl)
        if (parsed) cols[parsed[0]] = parsed[1]
      }
      tables[name] = cols
    } else if (/^DROP/i.test(s)) {
      const name = s.match(/DROP TABLE\s+(?:IF EXISTS\s+)?[`"[]?(\w+)/i)[1]
      delete tables[name]
    } else {
      const m = s.match(/ALTER TABLE\s+[`"[]?(\w+)[`"\]]?\s+RENAME TO\s+[`"[]?(\w+)/i)
      if (m && tables[m[1]]) {
        tables[m[2]] = tables[m[1]]
        delete tables[m[1]]
      }
    }
  }
  for (const t of Object.keys(tables)) if (t.startsWith('__new')) delete tables[t]
  return tables
}

const isNotNull = def => /\bNOT NULL\b/i.test(def)
const hasDefault = def => /\bDEFAULT\b/i.test(def)

/**
 * Compare two schemas.
 *
 * `live` (when given) is authoritative for restore safety: the migration files can
 * have drifted from the database that actually exists.
 */
export function diffSchemas(oldSql, newSql, liveSql = null) {
  const oldT = finalTables(oldSql)
  const newT = finalTables(newSql)
  const liveT = liveSql ? finalTables(liveSql) : null

  const droppedTables = Object.keys(oldT).filter(t => !(t in newT)).sort()
  const addedTables = Object.keys(newT).filter(t => !(t in oldT)).sort()

  const columns = []
  for (const t of Object.keys(oldT).filter(x => x in newT).sort()) {
    for (const c of [...new Set([...Object.keys(oldT[t]), ...Object.keys(newT[t])])].sort()) {
      const before = oldT[t][c]
      const after = newT[t][c]
      if (before === undefined) columns.push({ table: t, column: c, kind: 'added', after })
      else if (after === undefined) columns.push({ table: t, column: c, kind: 'removed', before })
      else if (before.toLowerCase() !== after.toLowerCase()) {
        columns.push({ table: t, column: c, kind: 'changed', before, after })
      }
    }
  }

  // Restore blockers — the failures that actually stop a data reload.
  const blockers = []
  if (liveT) {
    for (const t of Object.keys(liveT)) {
      if (!(t in newT)) continue // table not in the baseline: nothing to restore into
      for (const c of Object.keys(liveT[t])) {
        if (!(c in newT[t])) {
          blockers.push({ table: t, column: c, reason: 'live column missing from the new baseline — INSERT will fail' })
        }
      }
      for (const [c, def] of Object.entries(newT[t])) {
        if (!isNotNull(def) || hasDefault(def)) continue
        if (!(c in liveT[t])) {
          blockers.push({ table: t, column: c, reason: 'NOT NULL with no DEFAULT and absent from live data — INSERT will fail' })
        } else if (!isNotNull(liveT[t][c])) {
          // THE kassa case (#1455): the column exists on both sides, so a presence
          // check is blind to it. Live permits NULL, the new baseline forbids it —
          // any existing NULL row fails the restore.
          blockers.push({ table: t, column: c, reason: 'live column is NULLABLE but the new baseline makes it NOT NULL with no DEFAULT — existing NULL rows will fail the restore' })
        }
      }
    }
  } else {
    // Without a live dump, flag the shape of the kassa regression: a column that
    // became NOT NULL. Advisory — only a live dump can confirm it actually breaks.
    for (const c of columns) {
      if (c.kind === 'changed' && !isNotNull(c.before) && isNotNull(c.after) && !hasDefault(c.after)) {
        blockers.push({ table: c.table, column: c.column, reason: 'became NOT NULL (no DEFAULT) — pass --live to confirm against real rows' })
      }
    }
  }

  return { droppedTables, addedTables, columns, blockers }
}

function main(argv) {
  const args = argv.filter(a => a !== '--json')
  const json = argv.includes('--json')
  const liveIdx = args.indexOf('--live')
  const live = liveIdx !== -1 ? args[liveIdx + 1] : null
  const positional = args.filter((a, i) => a !== '--live' && (liveIdx === -1 || i !== liveIdx + 1))
  const [oldPath, newPath] = positional.slice(2)

  if (!oldPath || !newPath) {
    console.error('usage: node scripts/schema-diff.mjs <old.sql> <new.sql> [--live <dump.sql>] [--json]')
    process.exit(2)
  }

  const r = diffSchemas(
    readFileSync(oldPath, 'utf8'),
    readFileSync(newPath, 'utf8'),
    live ? readFileSync(live, 'utf8') : null
  )

  if (json) {
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.log(`tables dropped: ${r.droppedTables.join(', ') || '(none)'}`)
    console.log(`tables added:   ${r.addedTables.join(', ') || '(none)'}`)
    console.log(`\ncolumn differences (${r.columns.length}):`)
    for (const c of r.columns) {
      if (c.kind === 'added') console.log(`  + ${c.table}.${c.column}  (${c.after})`)
      else if (c.kind === 'removed') console.log(`  - ${c.table}.${c.column}  (was ${c.before})`)
      else console.log(`  ~ ${c.table}.${c.column}  ${c.before}  →  ${c.after}`)
    }
    console.log(`\nrestore blockers (${r.blockers.length}):`)
    for (const b of r.blockers) console.log(`  ✗ ${b.table}.${b.column} — ${b.reason}`)
    if (!r.blockers.length) console.log('  ✓ none — a data-only restore should load cleanly')
  }

  process.exit(r.blockers.length ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv)
