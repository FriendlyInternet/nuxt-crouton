import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// NB (#1448 probe finding): import with the explicit .ts extension.
import { resolveSchemaSources } from '../../../lib/utils/schema-sources.ts'

// Synthetic layer trees exercise the GRAPH-WALK mechanics (extends resolution,
// app-root inclusion, layers/* auto-scan, realpath dedup, the exact glob) on
// inputs we fully control. Node-resolution of real `@fyit/*` names and true
// NuxtHub equivalence are pinned separately by the parity suite against real
// fixtures (schema-sources-parity.test.ts).

let root: string

beforeEach(() => {
  // realpath the tmp root: macOS /var → /private/var, so our expectations
  // match what the resolver returns after its own realpath dedup.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'schema-sources-')))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

interface LayerOpts {
  extends?: string[]
  schema?: boolean            // server/db/schema.ts
  dialectFiles?: string[]     // e.g. schema.sqlite.ts, schema.pg.ts
  schemaDir?: string[]        // files under server/db/schema/
  otherFiles?: string[]       // server/db/*.ts OUTSIDE the exact glob
  croutonConfig?: string      // crouton.config.js contents
}

/** Scaffold a fake Nuxt layer at `dir`. Returns `dir`. */
function mklayer(dir: string, opts: LayerOpts = {}): string {
  mkdirSync(join(dir, 'server', 'db'), { recursive: true })
  writeFileSync(
    join(dir, 'nuxt.config.ts'),
    `export default defineNuxtConfig({ extends: ${JSON.stringify(opts.extends ?? [])} })\n`,
  )
  if (opts.schema) writeFileSync(join(dir, 'server/db/schema.ts'), 'export const t = 1\n')
  for (const f of opts.dialectFiles ?? []) writeFileSync(join(dir, 'server/db', f), 'export const t = 1\n')
  if (opts.schemaDir?.length) {
    mkdirSync(join(dir, 'server/db/schema'), { recursive: true })
    for (const f of opts.schemaDir) writeFileSync(join(dir, 'server/db/schema', f), 'export const t = 1\n')
  }
  for (const f of opts.otherFiles ?? []) writeFileSync(join(dir, 'server/db', f), 'export const t = 1\n')
  if (opts.croutonConfig) writeFileSync(join(dir, 'crouton.config.js'), opts.croutonConfig)
  return dir
}

describe('resolveSchemaSources', () => {
  describe('layer coverage', () => {
    it('includes the app root itself as a globbed layer', async () => {
      mklayer(root, { schema: true })
      const paths = await resolveSchemaSources(root)
      expect(paths).toContain(join(root, 'server/db/schema.ts'))
    })

    it('follows a relative extends to a base layer', async () => {
      const base = mklayer(join(root, 'base'), { schema: true })
      mklayer(root, { schema: true, extends: ['./base'] })
      const paths = await resolveSchemaSources(root)
      expect(paths).toEqual(expect.arrayContaining([
        join(root, 'server/db/schema.ts'),
        join(base, 'server/db/schema.ts'),
      ]))
    })

    it('follows a transitive extends, resolving each layer FROM ITS OWN dir', async () => {
      // base extends './deeper' — must resolve to base/deeper, not root/deeper.
      mklayer(join(root, 'base/deeper'), { schema: true })
      mklayer(join(root, 'base'), { extends: ['./deeper'] })
      mklayer(root, { extends: ['./base'] }) // app itself has no schema
      const paths = await resolveSchemaSources(root)
      expect(paths).toContain(join(root, 'base/deeper/server/db/schema.ts'))
      expect(paths).not.toContain(join(root, 'deeper/server/db/schema.ts'))
    })

    it('auto-scans layers/* even when NOT listed in the extends array', async () => {
      mklayer(join(root, 'layers/foo'), { schema: true })
      mklayer(root, { extends: [] }) // foo deliberately unlisted
      const paths = await resolveSchemaSources(root)
      expect(paths).toContain(join(root, 'layers/foo/server/db/schema.ts'))
    })
  })

  describe('dedup', () => {
    it('collects a layer reachable via two parents exactly once', async () => {
      mklayer(join(root, 'shared'), { schema: true })
      mklayer(join(root, 'a'), { extends: ['../shared'] })
      mklayer(join(root, 'b'), { extends: ['../shared'] })
      mklayer(root, { extends: ['./a', './b'] })
      const paths = await resolveSchemaSources(root)
      const shared = join(root, 'shared/server/db/schema.ts')
      expect(paths.filter(p => p === shared)).toHaveLength(1)
    })

    it('dedupes by realpath across a symlinked layer path', async () => {
      mklayer(join(root, 'real'), { schema: true })
      symlinkSync(join(root, 'real'), join(root, 'alias'), 'dir')
      mklayer(root, { extends: ['./real', './alias'] })
      const paths = await resolveSchemaSources(root)
      const real = realpathSync(join(root, 'real/server/db/schema.ts'))
      expect(paths.filter(p => realpathSync(p) === real)).toHaveLength(1)
    })

    it('returns no duplicate paths for a diamond-shaped graph', async () => {
      mklayer(join(root, 'shared'), { schema: true })
      mklayer(join(root, 'a'), { schema: true, extends: ['../shared'] })
      mklayer(join(root, 'b'), { schema: true, extends: ['../shared'] })
      mklayer(root, { schema: true, extends: ['./a', './b'] })
      const paths = await resolveSchemaSources(root)
      expect(new Set(paths).size).toBe(paths.length)
    })
  })

  describe('the exact glob (never widen)', () => {
    it('collects schema.<dialect>.ts for the active dialect and drops other dialects', async () => {
      mklayer(root, { dialectFiles: ['schema.sqlite.ts', 'schema.pg.ts'] })
      const paths = await resolveSchemaSources(root, { dialect: 'sqlite' })
      expect(paths).toContain(join(root, 'server/db/schema.sqlite.ts'))
      expect(paths).not.toContain(join(root, 'server/db/schema.pg.ts'))
    })

    it('collects files under server/db/schema/*.ts', async () => {
      mklayer(root, { schemaDir: ['a.ts', 'b.ts'] })
      const paths = await resolveSchemaSources(root)
      expect(paths).toEqual(expect.arrayContaining([
        join(root, 'server/db/schema/a.ts'),
        join(root, 'server/db/schema/b.ts'),
      ]))
    })

    it('ignores server/db/*.ts files outside the exact patterns', async () => {
      // translations-ui.ts is the load-bearing example: widening to
      // server/db/*.ts would double-define translations_ui for bookings apps.
      mklayer(root, { schema: true, otherFiles: ['translations-ui.ts', 'other.ts'] })
      const paths = await resolveSchemaSources(root)
      expect(paths).not.toContain(join(root, 'server/db/translations-ui.ts'))
      expect(paths).not.toContain(join(root, 'server/db/other.ts'))
    })
  })

  describe('source of truth = filesystem, not config', () => {
    it('ignores crouton.config.js collections (a config collection with no schema file is not collected)', async () => {
      mklayer(root, {
        schema: true,
        croutonConfig: 'export default { collections: { widgets: {} } }\n',
      })
      const paths = await resolveSchemaSources(root)
      // Only the real schema.ts — nothing invented for `widgets`.
      expect(paths).toEqual([join(root, 'server/db/schema.ts')])
    })
  })

  describe('robustness (must not crash)', () => {
    it('tolerates an extended layer with no server/db dir', async () => {
      mkdirSync(join(root, 'empty'), { recursive: true })
      writeFileSync(join(root, 'empty/nuxt.config.ts'), 'export default defineNuxtConfig({})\n')
      mklayer(root, { schema: true, extends: ['./empty'] })
      await expect(resolveSchemaSources(root)).resolves.toContain(join(root, 'server/db/schema.ts'))
    })

    it('tolerates a config-only layer (extends resolves, but no schema surfaces)', async () => {
      // Stand-in for the fanfare themes subpath-extends case; real subpath
      // resolution is exercised by the fanfare parity walk.
      mklayer(join(root, 'themeish'), {}) // has server/db dir but no schema files
      mklayer(root, { schema: true, extends: ['./themeish'] })
      const paths = await resolveSchemaSources(root)
      expect(paths).toEqual([join(root, 'server/db/schema.ts')])
    })
  })
})
