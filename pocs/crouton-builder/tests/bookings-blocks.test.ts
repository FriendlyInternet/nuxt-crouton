/**
 * #2559 — the bookings blocks offered in Builder (under the Bookings group; the
 * demo builderBookings list reads "Gigs · List").
 *
 * Runs the REAL merge Nuxt does at build time: `.nuxt/app.config.mjs` is
 * `defuFn(app, core, auth, layout, flow, bookings, …)`, highest layer first. The
 * same call over the same app.config files is what this test does, so the block
 * row it checks is the one the editor (and the served `/site/<slug>` page, which
 * resolves blocks from the same registry) gets.
 *
 * What a config test can't see — seeded bookings actually returned for the review
 * team — is checked on the deployed preview by `smoke.reads` in deploy.config.json.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { defuFn } from 'defu'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { paletteBlocksOf } from '../app/utils/palette-blocks'

const pkg = (name: string) => resolve(__dirname, '../../../packages', name)

let registry: CroutonLayoutBlockRegistry

beforeAll(async () => {
  // app.config files call the Nuxt auto-import `defineAppConfig` (identity at runtime).
  ;(globalThis as any).defineAppConfig = (c: unknown) => c
  const layers = await Promise.all([
    import('../app/app.config'),
    // Relative paths: the packages don't export their app.config (Nuxt reads it by layer path).
    import('../../../packages/crouton-core/app/app.config'),
    import('../../../packages/crouton-layout/app/app.config'),
    import('../../../packages/crouton-bookings/app/app.config'),
  ])
  const merged = defuFn(...(layers.map(m => m.default) as [object, ...object[]])) as {
    croutonLayoutBlocks: CroutonLayoutBlockRegistry
  }
  registry = merged.croutonLayoutBlocks
})

const PACKAGE_BLOCKS = {
  'bookings-calendar-only': { name: 'Bookings · Calendar', component: 'CroutonBookingsLayoutCalendarOnly' },
  'bookings-locations': { name: 'Bookings · Locations', component: 'CroutonBookingsLayoutLocations' },
  'bookings-package-list': { name: 'Bookings · Bookings list', component: 'CroutonBookingsLayoutList' },
} as const

// `CroutonBookings` + path under app/components (the package's component prefix).
const componentFile = (component: string) =>
  resolve(pkg('crouton-bookings'), 'app/components', component.replace(/^CroutonBookings/, '').replace(/^Layout(?=[A-Z])/, 'Layout/') + '.vue')

describe('bookings blocks in the Builder block row (#2559)', () => {
  it('offers the three atomic package blocks, labelled "Bookings · …", on the package components', () => {
    const offered = paletteBlocksOf(Object.values(registry))
    for (const [id, want] of Object.entries(PACKAGE_BLOCKS)) {
      const block = offered.find(b => b.id === id)
      expect(block, `${id} offered`).toBeDefined()
      expect(block!.name).toBe(want.name)
      expect(block!.component).toBe(want.component)
      expect(block!.kind).toBe('atomic')
      expect(existsSync(componentFile(want.component)), `${want.component} exists in crouton-bookings`).toBe(true)
    }
  })

  it('keeps the package\'s scope option on every package block (team bookings by default)', () => {
    for (const id of Object.keys(PACKAGE_BLOCKS)) {
      const fields = registry[id]!.configSchema ?? []
      expect(fields.map(f => f.name), id).toEqual(['scope'])
      expect(fields[0]!.default).toBe('team')
    }
  })

  it('hides the all-in-one compound calendar from the block row but keeps it renderable', () => {
    const offered = paletteBlocksOf(Object.values(registry))
    expect(offered.some(b => b.id === 'bookings-calendar')).toBe(false)
    expect(offered.every(b => b.kind !== 'compound')).toBe(true)
    // Still in the registry → a saved page that already holds one still renders.
    expect(registry['bookings-calendar']?.kind).toBe('compound')
    expect(registry['bookings-calendar']?.component).toBe('CroutonBookingsLayoutCalendar')
  })

  it('leaves the Filters block out of the row but keeps it registered and renderable', () => {
    // In a layout it shows only its ⚙️ menu (location cards need viewToggles, which the
    // layout block turns off) — Bookings · Locations already filters (#2559, #2561).
    expect(paletteBlocksOf(Object.values(registry)).some(b => b.id === 'bookings-filters')).toBe(false)
    expect(registry['bookings-filters']?.component).toBe('CroutonBookingsLayoutFilters')
    expect(existsSync(componentFile('CroutonBookingsLayoutFilters'))).toBe(true)
  })

  it('leaves the demo list block as it was, relabelled "Gigs · List" — its own two options, no package scope leaking in', () => {
    const demo = registry['bookings-list']!
    expect(demo.name).toBe('Gigs · List')
    expect(demo.defaultConfig).toEqual({ collection: 'builderBookings', heading: 'Bookings' })
    expect((demo.configSchema ?? []).map(f => f.name)).toEqual(['collection', 'heading'])
    expect(paletteBlocksOf(Object.values(registry)).some(b => b.id === 'bookings-list')).toBe(true)
  })
})
