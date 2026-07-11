import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import {
  prepareSchemaForMigration, generateMigrations, DuplicateTableError
} from '../../lib/utils/generate-migrations.ts'

// WS2 (#1449): the migration step runs drizzle-kit against the WS1a-resolved
// sources (WS1b gate as a pre-check) — no Nuxt process. `prepareSchemaForMigration`
// is the pre-drizzle phase (resolve + gate + report unresolved), separately
// testable; `generateMigrations` orchestrates it + the drizzle-kit invocation.

const ROOT = resolve(__dirname, '../../../..')
const DRIZZLE = 'import { sqliteTable, text } from \'drizzle-orm/sqlite-core\''

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(__dirname, '.tmp-ws2-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Minimal app/layer with a nuxt.config + optional schema defining a table. */
function mkApp(sub: string, opts: { extends?: string[], table?: string } = {}): string {
  const d = join(dir, sub)
  mkdirSync(join(d, 'server', 'db'), { recursive: true })
  writeFileSync(join(d, 'nuxt.config.ts'), `export default defineNuxtConfig({ extends: ${JSON.stringify(opts.extends ?? [])} })\n`)
  if (opts.table) {
    writeFileSync(join(d, 'server/db/schema.ts'), `${DRIZZLE}\nexport const t = sqliteTable('${opts.table}', { id: text('id').primaryKey() })\n`)
  }
  return d
}

describe('prepareSchemaForMigration', () => {
  it('returns the resolved paths for a clean app, no unresolved specs', async () => {
    const app = mkApp('app', { table: 'widgets' })
    const res = await prepareSchemaForMigration(app)
    expect(res.paths).toContain(join(app, 'server/db/schema.ts'))
    expect(res.unresolved).toEqual([])
  })

  it('throws DuplicateTableError naming both files when two distinct defs share a name', async () => {
    // app extends two local layers that each define a DIFFERENT widgets table
    const a = mkApp('layers/a', { table: 'widgets' })
    const b = mkApp('layers/b', { table: 'widgets' })
    const app = mkApp('app', { extends: ['../layers/a', '../layers/b'] })
    await expect(prepareSchemaForMigration(app)).rejects.toBeInstanceOf(DuplicateTableError)
    await expect(prepareSchemaForMigration(app)).rejects.toMatchObject({
      table: 'widgets',
      files: expect.arrayContaining([join(a, 'server/db/schema.ts'), join(b, 'server/db/schema.ts')])
    })
  })

  it('reports an unresolvable @fyit extends as unresolved (does not silently skip)', async () => {
    const app = mkApp('app', { extends: ['@fyit/crouton-does-not-exist'], table: 'widgets' })
    const res = await prepareSchemaForMigration(app)
    expect(res.unresolved).toContain('@fyit/crouton-does-not-exist')
  })
})

describe('generateMigrations — failure contract', () => {
  it('DEFERS with a recipe when a declared extends is unresolvable (not a hard fail)', async () => {
    const app = mkApp('app', { extends: ['@fyit/crouton-does-not-exist'], table: 'widgets' })
    const res = await generateMigrations(app)
    expect(res).toMatchObject({ generated: false, reason: 'deferred' })
    expect((res as any).recipe.join('\n')).toMatch(/pnpm install|db:generate/)
  })

  it('propagates a DuplicateTableError (→ non-zero exit at the CLI layer)', async () => {
    mkApp('layers/a', { table: 'widgets' })
    mkApp('layers/b', { table: 'widgets' })
    const app = mkApp('app', { extends: ['../layers/a', '../layers/b'] })
    await expect(generateMigrations(app)).rejects.toBeInstanceOf(DuplicateTableError)
  })
})

describe('WS2 invariant: the Nuxt round trip is gone', () => {
  it('the migration-GENERATION code path never shells out to Nuxt', () => {
    // The schema-bundling round trip is gone. Applying migrations
    // (`nuxt db:migrate`) is a separate, legitimate step and may remain.
    const files = [
      'lib/generate-collection.ts',
      'lib/utils/generate-migrations.ts',
      'lib/init-app.ts',
      'lib/add-module.ts'
    ].map(f => readFileSync(resolve(__dirname, '../..', f), 'utf8')).join('\n')
    expect(files).not.toContain('nuxt db generate')
    expect(files).not.toContain('nuxt build')
  })
})

describe('generateMigrations — real drizzle-kit run (acceptance, no Nuxt)', () => {
  it('cold generate on fixtures/minimal writes exactly one migration; second run is a no-op', () => {
    // The generated config + sync resolver, run by drizzle-kit against a real
    // fixture (built dist, installed deps) into a TEMP out — proves the end-to-end
    // mechanism without a Nuxt process and without mutating the fixture.
    const fixture = resolve(ROOT, 'fixtures/minimal')
    const outDir = join(dir, 'out')
    mkdirSync(outDir, { recursive: true })
    const cfg = join(fixture, 'drizzle.ws2-test.config.ts')
    writeFileSync(cfg, [
      'import { defineConfig } from \'drizzle-kit\'',
      'import { resolveSchemaSourcesSync } from \'@fyit/crouton-cli/lib/utils/schema-sources.ts\'',
      `export default defineConfig({ dialect: 'sqlite', schema: resolveSchemaSourcesSync(process.cwd()), out: ${JSON.stringify(outDir)} })`
    ].join('\n'))
    try {
      const bin = join(fixture, 'node_modules/.bin/drizzle-kit')
      execFileSync(bin, ['generate', '--config', cfg], { cwd: fixture, stdio: 'pipe' })
      const sql1 = readdirSync(outDir).filter(f => f.endsWith('.sql'))
      expect(sql1).toHaveLength(1)
      // Second run is a no-op: no NEW .sql is written (the real no-op signal;
      // drizzle-kit's "No schema changes" text goes to stderr and is brittle).
      execFileSync(bin, ['generate', '--config', cfg], { cwd: fixture, stdio: 'pipe' })
      expect(readdirSync(outDir).filter(f => f.endsWith('.sql'))).toEqual(sql1)
    } finally {
      rmSync(cfg, { force: true })
    }
  })
})
