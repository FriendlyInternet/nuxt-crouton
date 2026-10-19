import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mergeManifestCollections } from '../../../lib/utils/manifest-merge.ts'

// Package collections are merged for the packages the app EXTENDS, not for
// keys in `crouton.config.js features` (#2286). Real manifests from packages/*.
// crouton-pages is the example: it still ships a `collections` list the app
// generates (crouton-sales and crouton-bookings own theirs since #2278).
// Non-interactive (CI) so configuration prompts take their defaults.

let prevCI: string | undefined
beforeAll(() => { prevCI = process.env.CI; process.env.CI = '1' })
afterAll(() => { if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI })

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
    const result = await mergeManifestCollections(config, ['crouton-pages'])
    expect(result.merged).toBeGreaterThan(0)
    expect(result.collections.every(c => c.feature === 'pages')).toBe(true)
    expect(config.targets.some(t => t.layer === 'pages')).toBe(true)
  })

  it('does not merge a package the app does not extend, even if features names it', async () => {
    const config = { ...freshConfig(), features: { pages: true } }
    const result = await mergeManifestCollections(config, ['crouton-core'])
    expect(result.merged).toBe(0)
  })

  it('skips a package that owns its collections (#2278)', async () => {
    for (const owner of ['crouton-sales', 'crouton-bookings']) {
      const config = freshConfig()
      const result = await mergeManifestCollections(config, [owner])
      expect(result.merged).toBe(0)
    }
  })

  it('keeps a user-defined collection over the package\'s', async () => {
    const config = { collections: [{ name: 'pages', fieldsFile: './schemas/pages.json' }], targets: [] as any[] }
    const result = await mergeManifestCollections(config, ['crouton-pages'])
    expect(result.skipped).toContain('pages')
    expect(config.collections.filter(c => c.name === 'pages')).toHaveLength(1)
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
