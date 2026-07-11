import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { resolveSchemaSources, resolveSchemaSourcesSync } from '../../../lib/utils/schema-sources.ts'

// WS2 (#1449): the generated drizzle.config.ts must resolve the schema list at
// runtime, but drizzle-kit's esbuild config loader is CJS and rejects top-level
// await — so the config cannot `await resolveSchemaSources`. The resolver's body
// is already synchronous, so WS2 exposes a sync variant the config calls with no
// await. It MUST return exactly what the async version returns.

const ROOT = resolve(__dirname, '../../../../..')

describe('resolveSchemaSourcesSync', () => {
  for (const dir of ['fixtures/minimal', 'fixtures/with-sales', 'fixtures/nested-schema']) {
    it(`matches the async resolver for ${dir}`, async () => {
      const app = resolve(ROOT, dir)
      const asyncPaths = await resolveSchemaSources(app)
      const syncPaths = resolveSchemaSourcesSync(app)
      expect(syncPaths).toEqual(asyncPaths)
    })
  }

  it('honours the dialect option like the async version', async () => {
    const app = resolve(ROOT, 'fixtures/minimal')
    expect(resolveSchemaSourcesSync(app, { dialect: 'sqlite' }))
      .toEqual(await resolveSchemaSources(app, { dialect: 'sqlite' }))
  })
})
