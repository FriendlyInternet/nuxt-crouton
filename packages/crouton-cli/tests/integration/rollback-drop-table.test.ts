import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { generateDropMigration } from '../../lib/rollback-collection.ts'

// WS4 (#1451) part 3 — the DROP contract, proven against a real drizzle-kit + a
// real in-sync meta snapshot, with no Nuxt process.
//
// The temp app is created INSIDE fixtures/minimal so Node resolution walks up to
// its node_modules (drizzle-kit, drizzle-orm, @fyit/crouton-cli). It extends
// nothing, so its resolved schema is exactly one collection table (`shop_widgets`)
// — no crouton-layout drift. We generate its baseline (0000 CREATE) so the meta
// snapshot is in sync, then a code-only rollback of that collection makes the sole
// diff a DROP. --dry-run runs that diff into a TEMP out (copied meta), prints the
// SQL, and restores the barrel byte-for-byte — writing NOTHING to the app.

const ROOT = resolve(__dirname, '../../../..')
const FIXTURE = resolve(ROOT, 'fixtures/minimal') // host for node_modules resolution
const BIN = join(FIXTURE, 'node_modules/.bin/drizzle-kit')
const OUT = 'server/db/migrations/sqlite'

let app: string
beforeEach(() => {
  app = mkdtempSync(join(FIXTURE, '.tmp-ws4-'))
  mkdirSync(join(app, 'server/db'), { recursive: true })
  mkdirSync(join(app, 'layers/shop/collections/widgets/server/database'), { recursive: true })
  writeFileSync(join(app, 'nuxt.config.ts'), 'export default defineNuxtConfig({ extends: [] })\n')
  writeFileSync(
    join(app, 'layers/shop/collections/widgets/server/database/schema.ts'),
    `import { sqliteTable, text } from 'drizzle-orm/sqlite-core'\n`
      + `export const shopWidgets = sqliteTable('shop_widgets', { id: text('id').primaryKey() })\n`
  )
  writeFileSync(
    join(app, 'server/db/schema.ts'),
    `export { shopWidgets } from '../../layers/shop/collections/widgets/server/database/schema'\n`
  )
  // Baseline: generate the in-sync 0000 (CREATE shop_widgets) into the app's out.
  const cfg = join(app, 'drizzle.baseline.config.ts')
  writeFileSync(cfg, [
    `import { defineConfig } from 'drizzle-kit'`,
    `import { resolveSchemaSourcesSync } from '@fyit/crouton-cli/lib/utils/schema-sources.ts'`,
    `export default defineConfig({ dialect: 'sqlite', schema: resolveSchemaSourcesSync(process.cwd()), out: '${OUT}' })`,
  ].join('\n') + '\n')
  execFileSync(BIN, ['generate', '--config', cfg], { cwd: app, stdio: 'pipe' })
  rmSync(cfg, { force: true })
})
afterEach(() => rmSync(app, { recursive: true, force: true }))

describe('generateDropMigration — dry-run preview', () => {
  it('previews DROP TABLE shop_widgets, writes nothing to the app, restores the barrel', async () => {
    const barrel = join(app, 'server/db/schema.ts')
    const barrelBefore = readFileSync(barrel, 'utf8')
    const sqlBefore = readdirSync(join(app, OUT)).filter(f => f.endsWith('.sql')).sort()

    const res = await generateDropMigration({
      appDir: app,
      layer: 'shop',
      collection: 'widgets',
      dryRun: true,
    })

    // Preview shows the DROP for the rolled-back collection's table.
    expect(res.wrote).toBe(false)
    expect(res.sql).toMatch(/DROP TABLE[^\n]*shop_widgets/i)

    // Nothing written to the app: barrel restored byte-identical, no new .sql.
    expect(readFileSync(barrel, 'utf8')).toBe(barrelBefore)
    expect(readdirSync(join(app, OUT)).filter(f => f.endsWith('.sql')).sort()).toEqual(sqlBefore)
  })
})
