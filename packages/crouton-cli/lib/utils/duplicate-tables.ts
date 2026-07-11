// duplicate-tables.ts — the identity-aware duplicate-table gate over the WS1a
// schema-source resolver's output (epic #1445, WS1b #1447).
//
// drizzle-kit does NOT error on two same-named tables across its schema list —
// it silently last-wins, order-dependently. This makes that loud, but ONLY for
// two GENUINELY DISTINCT definitions. The standard topology legitimately
// re-exports the SAME auth tables via multiple bridges/barrels; loaded through a
// SINGLE jiti instance those are the same object (its module cache returns one
// object for a re-exported definition), so they are not a clash. The gate keys
// on object IDENTITY, not the name alone — which also catches a distinct
// duplicate arriving via `export * from` (a definition-regex scan would miss it,
// since the re-exporting file has no `sqliteTable(` call).
//
// Reports at the RESOLVED-file level (which bridge/barrel), not the deep
// definition site. Import errors propagate — the dist/loadability prerequisite
// is the caller's failure contract (WS2), not silently swallowed here.

import { createJiti } from 'jiti'
import { isTable, getTableName } from 'drizzle-orm'

export interface DuplicateTable {
  /** The SQL table name that two or more distinct definitions share. */
  table: string
  /** The resolved files that contributed a definition of `table`. */
  files: string[]
}

/**
 * Find table names defined by two or more DISTINCT drizzle definitions across
 * the resolved schema files. Same definition re-exported through several files
 * is benign and not reported. Returns [] when the set is clean.
 */
export async function findDuplicateTables(resolvedPaths: string[]): Promise<DuplicateTable[]> {
  // One jiti instance so a re-exported definition is the SAME object everywhere.
  const jiti = createJiti(import.meta.url)

  // name -> { the distinct table objects seen, the files that surfaced them }
  const byName = new Map<string, { objects: Set<unknown>, files: Set<string> }>()

  for (const path of resolvedPaths) {
    const mod = (await jiti.import(path)) as Record<string, unknown>
    for (const value of Object.values(mod)) {
      if (!isTable(value)) continue
      const name = getTableName(value)
      let entry = byName.get(name)
      if (!entry) {
        entry = { objects: new Set(), files: new Set() }
        byName.set(name, entry)
      }
      entry.objects.add(value)
      entry.files.add(path)
    }
  }

  const duplicates: DuplicateTable[] = []
  for (const [table, { objects, files }] of byName) {
    // A clash is >= 2 definitions of DISTINCT identity — not merely >= 2 files.
    if (objects.size >= 2) duplicates.push({ table, files: [...files] })
  }
  return duplicates
}
