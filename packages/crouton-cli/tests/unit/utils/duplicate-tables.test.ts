import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// NB: import with the explicit .ts extension (matches the package's test style).
import { findDuplicateTables } from '../../../lib/utils/duplicate-tables.ts'

// WS1b (#1447): the identity-aware duplicate-table gate over the WS1a resolver's
// output. drizzle-kit silently last-wins on two same-named tables (order-dependent,
// no warning); this makes that loud — BUT only for two DISTINCT definitions. The
// standard topology legitimately re-exports the SAME auth tables via multiple
// bridges/barrels (same object identity through one jiti cache) — those must pass.
//
// Empirically grounded (booking-demo): a benign `export * from` re-export yields
// the SAME table object; two independent sqliteTable('x',…) calls yield DISTINCT
// objects with the same name. The gate keys on object identity, not the name alone.
//
// Temp schema files live UNDER the package (not os.tmpdir()) so `drizzle-orm`
// resolves via node walk-up when the gate jiti-imports them.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(__dirname, '.tmp-dupgate-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const DRIZZLE = "import { sqliteTable, text } from 'drizzle-orm/sqlite-core'"

/** Write a schema file that DEFINES a table with the given SQL name. */
function defineTable(file: string, exportName: string, sqlName: string): string {
  const p = join(dir, file)
  writeFileSync(p, `${DRIZZLE}\nexport const ${exportName} = sqliteTable('${sqlName}', { id: text('id').primaryKey() })\n`)
  return p
}

/** Write a schema file that re-exports everything from another file (same objects). */
function reExport(file: string, from: string): string {
  const p = join(dir, file)
  writeFileSync(p, `export * from './${from}'\n`)
  return p
}

describe('findDuplicateTables', () => {
  it('returns no duplicates for a clean set of distinctly-named tables', async () => {
    const a = defineTable('a.ts', 'widgets', 'widgets')
    const b = defineTable('b.ts', 'gadgets', 'gadgets')
    expect(await findDuplicateTables([a, b])).toEqual([])
  })

  it('passes a benign re-export — the SAME table reached via two resolved files', async () => {
    // Mirrors the auth topology: a shared definition re-exported by two bridges.
    defineTable('base.ts', 'widgets', 'widgets')
    const bridge = reExport('bridge.ts', 'base')
    const barrel = reExport('barrel.ts', 'base')
    // Both resolved files surface the SAME widgets object → not a conflict.
    expect(await findDuplicateTables([bridge, barrel])).toEqual([])
  })

  it('flags two DISTINCT definitions that share a table name, naming both resolved files', async () => {
    const a = defineTable('a.ts', 'widgetsA', 'widgets')
    const b = defineTable('b.ts', 'widgetsB', 'widgets')
    const dups = await findDuplicateTables([a, b])
    expect(dups).toHaveLength(1)
    expect(dups[0].table).toBe('widgets')
    expect(dups[0].files.sort()).toEqual([a, b].sort())
  })

  it('catches a distinct duplicate that arrives via re-export (regex over the globbed file would miss it)', async () => {
    // a.ts DEFINES widgets; b.ts RE-EXPORTS a *different* widgets from elsewhere.
    // b.ts has no `sqliteTable(` call, so a definition-regex scan sees only one
    // def and misses the clash — identity import-and-collect catches it.
    const a = defineTable('a.ts', 'widgets', 'widgets')
    defineTable('other.ts', 'widgetsOther', 'widgets')
    const b = reExport('b.ts', 'other')
    const dups = await findDuplicateTables([a, b])
    expect(dups).toHaveLength(1)
    expect(dups[0].table).toBe('widgets')
    expect(dups[0].files.sort()).toEqual([a, b].sort())
  })

  it('does not flag a single file that defines two differently-named tables', async () => {
    const p = join(dir, 'multi.ts')
    writeFileSync(p, `${DRIZZLE}\nexport const a = sqliteTable('a', { id: text('id') })\nexport const b = sqliteTable('b', { id: text('id') })\n`)
    expect(await findDuplicateTables([p])).toEqual([])
  })

  it('reports each clashing name once even when three distinct definitions collide', async () => {
    const a = defineTable('a.ts', 'wa', 'widgets')
    const b = defineTable('b.ts', 'wb', 'widgets')
    const c = defineTable('c.ts', 'wc', 'widgets')
    const dups = await findDuplicateTables([a, b, c])
    expect(dups).toHaveLength(1)
    expect(dups[0].table).toBe('widgets')
    expect(dups[0].files.sort()).toEqual([a, b, c].sort())
  })
})

describe('findDuplicateTables — real benign topology (acceptance)', () => {
  it('booking-demo: auth tables reachable via the bookings bridge AND the app barrel do NOT clash', async () => {
    const root = join(__dirname, '../../../../..')
    const bridge = join(root, 'packages/crouton-bookings/server/db/schema.ts')
    const barrel = join(root, 'pocs/booking-demo/server/db/schema.ts')
    // Same auth bindings re-exported by both — must pass (proven: 16/16 same identity).
    expect(await findDuplicateTables([bridge, barrel])).toEqual([])
  })
})
