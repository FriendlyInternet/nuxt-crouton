import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mergeManifestCollections } from '../../../lib/utils/manifest-merge.ts'

// Package collections are merged for the packages the app EXTENDS, not for
// keys in `crouton.config.js features` (#2286). Real manifests from packages/*.
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
    const result = await mergeManifestCollections(config, ['crouton-bookings'])
    expect(result.merged).toBeGreaterThan(0)
    expect(result.collections.every(c => c.feature === 'bookings')).toBe(true)
    expect(config.targets.some(t => t.layer === 'bookings')).toBe(true)
  })

  it('does not merge a package the app does not extend, even if features names it', async () => {
    const config = { ...freshConfig(), features: { bookings: true } }
    const result = await mergeManifestCollections(config, ['crouton-core'])
    expect(result.merged).toBe(0)
  })

  it('skips a package that owns its collections (#2278)', async () => {
    const config = freshConfig()
    const result = await mergeManifestCollections(config, ['crouton-sales'])
    expect(result.merged).toBe(0)
  })

  it('keeps a user-defined collection over the package\'s', async () => {
    const config = { collections: [{ name: 'bookings', fieldsFile: './schemas/bookings.json' }], targets: [] as any[] }
    const result = await mergeManifestCollections(config, ['crouton-bookings'])
    expect(result.skipped).toContain('bookings')
    expect(config.collections.filter(c => c.name === 'bookings')).toHaveLength(1)
  })

  it('stores a package\'s prompted configuration under features.<alias> (the config carrier)', async () => {
    const config = freshConfig()
    const result = await mergeManifestCollections(config, ['crouton-bookings'])
    for (const pc of result.promptedConfigs) {
      expect(config.features?.[pc.featureKey]).toEqual(pc.configObject)
    }
  })
})
