import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeManifestCollections } from '../../../lib/utils/manifest-merge.ts'

// Package collections are merged for the packages the app EXTENDS, not for
// keys in `crouton.config.js features` (#2286). Real manifests from packages/*,
// plus one test-local manifest: since #2278 every shipping package that lists
// collections owns them (sales, bookings, pages, assets), so no real manifest
// still exercises the merge path. `crouton-merge-fixture` stands in for one that does.
// Non-interactive (CI) so configuration prompts take their defaults.

const fixture = vi.hoisted(() => ({ schemaPath: '' }))

vi.mock('../../../lib/utils/manifest-loader.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/utils/manifest-loader.ts')>()
  return {
    ...real,
    discoverManifests: async () => [
      ...await real.discoverManifests(),
      { id: 'crouton-merge-fixture', layer: { name: 'notes' }, collections: [{ name: 'note', schemaPath: fixture.schemaPath }] },
    ],
  }
})

let prevCI: string | undefined
let tmp: string
beforeAll(() => {
  prevCI = process.env.CI; process.env.CI = '1'
  tmp = mkdtempSync(join(tmpdir(), 'manifest-merge-'))
  fixture.schemaPath = join(tmp, 'note.json')
  writeFileSync(fixture.schemaPath, JSON.stringify({ title: { type: 'string' } }))
})
afterAll(() => {
  if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI
  rmSync(tmp, { recursive: true, force: true })
})

function freshConfig(): { collections: any[]; targets: any[]; features?: Record<string, unknown> } {
  return { collections: [], targets: [] }
}

describe('mergeManifestCollections (keyed on extended packages)', () => {
  it('merges nothing when the app extends nothing', async () => {
    const config = freshConfig()
    const result = await mergeManifestCollections(config, [])
    expect(result.merged).toBe(0)
    expect(config.collections).toEqual([])
  })

  it('merges a package\'s collections when the app extends it, with no features block at all', async () => {
    const config = freshConfig()
    const result = await mergeManifestCollections(config, ['crouton-merge-fixture'])
    expect(result.merged).toBe(1)
    expect(result.collections).toEqual([{ name: 'notes', layer: 'notes', feature: 'merge-fixture' }])
    expect(config.targets.some(t => t.layer === 'notes')).toBe(true)
  })

  it('does not merge a package the app does not extend, even if features names it', async () => {
    const config = { ...freshConfig(), features: { 'merge-fixture': true } }
    const result = await mergeManifestCollections(config, ['crouton-core'])
    expect(result.merged).toBe(0)
  })

  it('skips a package that owns its collections (#2278)', async () => {
    for (const owner of ['crouton-sales', 'crouton-bookings', 'crouton-pages', 'crouton-assets']) {
      const config = freshConfig()
      const result = await mergeManifestCollections(config, [owner])
      expect(result.merged).toBe(0)
    }
  })

  it('keeps a user-defined collection over the package\'s', async () => {
    const config = { collections: [{ name: 'notes', fieldsFile: './schemas/notes.json' }], targets: [] as any[] }
    const result = await mergeManifestCollections(config, ['crouton-merge-fixture'])
    expect(result.skipped).toContain('notes')
    expect(config.collections.filter(c => c.name === 'notes')).toHaveLength(1)
  })

  it('still asks an OWNING package\'s setup questions and stores the answers under features.<alias> (#2307)', async () => {
    // crouton-bookings owns its collections (#2278) AND declares `configuration`
    // (email). Owning must skip the merge, not the questions: non-interactive
    // here, so the manifest defaults are taken.
    const config = freshConfig()
    const result = await mergeManifestCollections(config, ['crouton-bookings'])
    expect(result.merged).toBe(0)
    const pc = result.promptedConfigs.find(p => p.featureKey === 'bookings')
    expect(pc).toBeDefined()
    expect(config.features?.bookings).toEqual(pc!.configObject)
    expect(pc!.runtimeConfig?.public).toHaveProperty('croutonBookings')
  })
})
