import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { applyManifestConfiguration } from '../../../lib/utils/manifest-configuration.ts'

// A package's setup questions are asked for the packages the app EXTENDS, not
// for keys in `crouton.config.js features` (#2286). Real manifests from
// packages/*. Non-interactive (CI) so the prompts take their defaults.

let prevCI: string | undefined
beforeAll(() => { prevCI = process.env.CI; process.env.CI = '1' })
afterAll(() => { if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI })

describe('applyManifestConfiguration (keyed on extended packages)', () => {
  it('asks nothing when the app extends nothing', async () => {
    const config: { features?: Record<string, unknown> } = {}
    expect(await applyManifestConfiguration(config, [])).toEqual([])
    expect(config.features).toBeUndefined()
  })

  it('asks a package\'s setup questions and stores the answers under features.<alias> (#2307)', async () => {
    // crouton-bookings owns its collections (#2278) AND declares `configuration` (email).
    const config: { features?: Record<string, unknown> } = {}
    const prompted = await applyManifestConfiguration(config, ['crouton-bookings'])
    const pc = prompted.find(p => p.featureKey === 'bookings')
    expect(pc).toBeDefined()
    expect(config.features?.bookings).toEqual(pc!.configObject)
    expect(pc!.runtimeConfig?.public).toHaveProperty('croutonBookings')
  })

  it('does not ask a package the app does not extend, even if features names it', async () => {
    const config = { features: { bookings: true } as Record<string, unknown> }
    expect(await applyManifestConfiguration(config, ['crouton-core'])).toEqual([])
    expect(config.features.bookings).toBe(true)
  })

  it('keeps an existing config object instead of asking again', async () => {
    const existing = { config: { email: { enabled: true } } }
    const config = { features: { bookings: existing } as Record<string, unknown> }
    expect(await applyManifestConfiguration(config, ['crouton-bookings'])).toEqual([])
    expect(config.features.bookings).toBe(existing)
  })

  it('never adds collections to the config (#2316)', async () => {
    const config: Record<string, any> = { collections: [], targets: [] }
    await applyManifestConfiguration(config, ['crouton-sales', 'crouton-bookings', 'crouton-pages', 'crouton-assets'])
    expect(config.collections).toEqual([])
    expect(config.targets).toEqual([])
  })
})
