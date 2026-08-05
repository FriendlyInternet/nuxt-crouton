import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import consola from 'consola'
import {
  cleanSchemaIndex,
  rollbackCollection,
  orphanTableName,
  dropTableWarning,
} from '../../lib/rollback-collection.ts'
import { buildSchemaExportNames } from '../../lib/generate-collection.ts'

// WS4 (#1451): rollback stops breaking the next generate.
// Part 1 — cleanSchemaIndex must route through getSchemaPath (modern→legacy),
//          not the hardcoded legacy server/database/schema/index.ts.
// Part 2 — buildSchemaExportNames must resolve the barrel via the same helper.
// Part 3 — a code-only rollback names the orphaned table + warns the next
//          generate emits its DROP; --drop-table emits/previews that DROP.

const AUTH = `export * from '@fyit/crouton-auth/server/database/schema/auth'`
// The collection re-export line a generate wrote into the barrel.
const COLLECTION_EXPORT = `export { mainItems } from '../../layers/main/collections/items/server/database/schema'`

let dir: string
let cwd0: string
beforeEach(() => {
  dir = mkdtempSync(join(__dirname, '.tmp-ws4-'))
  cwd0 = process.cwd()
})
afterEach(() => {
  process.chdir(cwd0)
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** Write a barrel file at an app-relative path under the temp app dir. */
function mkBarrel(rel: string): string {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, `${AUTH}\n${COLLECTION_EXPORT}\n`)
  return p
}

/** Write the collection's own generated schema so its table name is discoverable. */
function mkCollectionSchema(tableName = 'main_items') {
  const p = join(dir, 'layers/main/collections/items/server/database/schema.ts')
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(
    p,
    `import { sqliteTable, text } from 'drizzle-orm/sqlite-core'\n`
      + `export const mainItems = sqliteTable('${tableName}', { id: text('id').primaryKey() })\n`
  )
}

describe('WS4 part 1 — cleanSchemaIndex routes through getSchemaPath', () => {
  it('cleans a MODERN server/db/schema.ts barrel (no-ops today → regression)', async () => {
    const barrel = mkBarrel('server/db/schema.ts')
    process.chdir(dir)
    const changed = await cleanSchemaIndex('items', 'main', false)
    expect(changed).toBe(true)
    // The dangling collection re-export is gone; auth stays.
    const after = readFileSync(barrel, 'utf8')
    expect(after).not.toContain('main/collections/items')
    expect(after).toContain('crouton-auth')
  })

  it('still cleans a LEGACY server/database/schema/index.ts barrel (no regression)', async () => {
    const barrel = mkBarrel('server/database/schema/index.ts')
    process.chdir(dir)
    const changed = await cleanSchemaIndex('items', 'main', false)
    expect(changed).toBe(true)
    expect(readFileSync(barrel, 'utf8')).not.toContain('main/collections/items')
  })
})

describe('WS4 part 1 — rollbackCollection leaves no dangling export', () => {
  it('a modern-barrel rollback removes the collection export (so the next generate loads)', async () => {
    const barrel = mkBarrel('server/db/schema.ts')
    // collection files present so rollback proceeds
    mkCollectionSchema()
    process.chdir(dir)
    await rollbackCollection({ layer: 'main', collection: 'items' })
    expect(readFileSync(barrel, 'utf8')).not.toContain('main/collections/items')
  })
})

describe('WS4 part 2 — buildSchemaExportNames resolves the barrel via getSchemaPath', () => {
  it('modern app → server/db/schema.ts', async () => {
    mkBarrel('server/db/schema.ts')
    process.chdir(dir)
    const { schemaIndexPath } = await buildSchemaExportNames('items', 'main')
    expect(schemaIndexPath.replace(/\\/g, '/')).toMatch(/\/server\/db\/schema\.ts$/)
  })

  it('legacy-flat app (only server/database/schema.ts) → that path, not the hardcoded modern one', async () => {
    mkBarrel('server/database/schema.ts')
    process.chdir(dir)
    const { schemaIndexPath } = await buildSchemaExportNames('items', 'main')
    expect(schemaIndexPath.replace(/\\/g, '/')).toMatch(/\/server\/database\/schema\.ts$/)
  })
})

describe('WS4 part 3 — orphan-table naming + warning', () => {
  it('orphanTableName reads the SQL name from the collection schema (not just derived)', async () => {
    mkCollectionSchema('custom_items_tbl') // NOT the derived main_items
    expect(await orphanTableName('main', 'items', dir)).toBe('custom_items_tbl')
  })

  it('orphanTableName falls back to the derived snake_case name when the file is gone', async () => {
    expect(await orphanTableName('main', 'items', dir)).toBe('main_items')
  })

  it('dropTableWarning names the table and the next-generate DROP consequence', () => {
    const msg = dropTableWarning('main_items')
    expect(msg).toContain('main_items')
    expect(msg).toMatch(/DROP TABLE/)
    expect(msg).toMatch(/next .*generate/i)
  })

  it('a code-only rollback (no --drop-table) emits the orphan warning naming the table', async () => {
    mkBarrel('server/db/schema.ts')
    mkCollectionSchema('main_items')
    process.chdir(dir)
    const warn = vi.spyOn(consola, 'warn')
    await rollbackCollection({ layer: 'main', collection: 'items' })
    const warned = warn.mock.calls.map(c => String(c[0])).join('\n')
    expect(warned).toContain('main_items')
    expect(warned).toMatch(/DROP TABLE/)
  })
})
