import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { applyManifestConfiguration, buildRuntimeAndEnvHints } from '../../../lib/utils/manifest-configuration.ts'

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
    expect(pc!.runtimeConfig?.server).toHaveProperty('croutonBookings')
    expect(pc!.warnings).toBeUndefined()
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

describe('runtimeConfig key + placement (#3398)', () => {
  it('writes maps settings where crouton-maps reads them', async () => {
    const config: { features?: Record<string, unknown> } = {}
    const prompted = await applyManifestConfiguration(config, ['crouton-maps'])
    const pc = prompted.find(p => p.featureKey === 'maps')!
    expect(pc.runtimeConfig?.public).toEqual({ maps: { style: 'liberty' } })
    expect(pc.runtimeConfig?.server).toEqual({ maps: { geocodingUrl: 'https://nominatim.openstreetmap.org' } })
    expect(JSON.stringify(pc.runtimeConfig)).not.toContain('croutonMaps')
  })

  it('falls back to crouton<Feature> and warns when runtimeConfigKey is undeclared', () => {
    const manifest = {
      id: 'crouton-widgets',
      configuration: { 'a.b': { type: 'number' as const, label: 'x', default: 1 } },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = buildRuntimeAndEnvHints('widgets', { config: { a: { b: 1 } } }, manifest)
    warn.mockRestore()
    expect((out.runtimeConfig!.server as any).croutonWidgets.a.b).toBe(1)
    expect((out.runtimeConfig!.public as any).croutonWidgets.a.b).toBe(1)
    expect(out.warnings![0]).toContain('runtimeConfigKey')
  })
})
