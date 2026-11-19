/**
 * #3815 — every block says how tall it wants to be: Fit (`sizing.height: 'hug'`) or
 * Fill (`'fill'`), always written out, plus a `minHeight` floor.
 *
 * Runs the REAL merge Nuxt does at build time (`defuFn(app, core, layout, bookings)`,
 * highest layer first — same as bookings-blocks.test.ts), then reads the result
 * through `deriveSizing`, the function the renderer / floor readout use.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { defuFn } from 'defu'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { deriveSizing } from '../../../packages/crouton-layout/app/utils/layout-viability'
import { groupPaletteBlocks } from '../app/utils/palette-groups'
import { paletteBlocksOf } from '../app/utils/palette-blocks'

type Registry = CroutonLayoutBlockRegistry
let registry: Registry
let layoutLayer: Registry
let bookingsLayer: Registry

beforeAll(async () => {
  // app.config files call the Nuxt auto-import `defineAppConfig` (identity at runtime).
  ;(globalThis as Record<string, unknown>).defineAppConfig = (c: unknown) => c
  const layers = await Promise.all([
    import('../app/app.config'),
    import('../../../packages/crouton-core/app/app.config'),
    import('../../../packages/crouton-layout/app/app.config'),
    import('../../../packages/crouton-bookings/app/app.config'),
  ])
  const configs = layers.map(m => m.default) as Array<{ croutonLayoutBlocks: Registry }>
  // Raw package layers, read before the merge (defu doesn't mutate, but be explicit).
  layoutLayer = structuredClone(configs[2]!.croutonLayoutBlocks)
  bookingsLayer = structuredClone(configs[3]!.croutonLayoutBlocks)
  const merged = defuFn(...(configs as [object, ...object[]])) as { croutonLayoutBlocks: Registry }
  registry = merged.croutonLayoutBlocks
})

const LISTED = {
  'collection-list': 'fill',
  'entity-form': 'fill',
  'stats': 'hug',
  'bookings-calendar': 'fill',
  'bookings-calendar-only': 'fill',
  'bookings-list': 'fill',
  'bookings-locations': 'fill',
  'bookings-filters': 'hug',
  'artists-list': 'fill',
  'artists-form': 'fill',
  'bookings-package-list': 'fill',
  'artists-stats': 'hug',
  'app-toolbar': 'hug',
  'app-nav': 'hug',
} as const

const LAYOUT_IDS = ['collection-list', 'entity-form', 'stats'] as const
const BOOKINGS_IDS = ['bookings-calendar', 'bookings-calendar-only', 'bookings-list', 'bookings-locations', 'bookings-filters'] as const

const leaf = (blockId: string): LayoutNode => ({ type: 'leaf', blockId } as LayoutNode)

describe('block sizing contract (#3815)', () => {
  it('every listed block derives its Fit/Fill and a minimum height', () => {
    for (const [id, height] of Object.entries(LISTED)) {
      const d = deriveSizing(leaf(id), registry)
      expect(d.height, `${id} height`).toBe(height)
      expect(d.minHeight, `${id} minHeight`).toBeGreaterThan(0)
    }
  })

  it('package blocks declare it in their own layer', () => {
    // Builder's `bookings-list` (Gigs) wins the merge, so the merged registry can't
    // see the package's own `bookings-list` — check each package layer directly.
    for (const [layer, ids] of [[layoutLayer, LAYOUT_IDS], [bookingsLayer, BOOKINGS_IDS]] as const) {
      for (const id of ids) {
        const d = deriveSizing(leaf(id), layer)
        expect(d.height, `${id} height (own layer)`).toBe(LISTED[id])
        expect(d.minHeight, `${id} minHeight (own layer)`).toBeGreaterThan(0)
      }
    }
  })

  it('a Stats-over-List column adds up its minimums', () => {
    for (const [stats, list] of [['artists-stats', 'artists-list'], ['stats', 'collection-list']] as const) {
      const column: LayoutNode = { type: 'split', direction: 'vertical', children: [leaf(stats), leaf(list)] } as LayoutNode
      const want = registry[stats]!.minHeight! + registry[list]!.minHeight!
      expect(want).toBeGreaterThan(0)
      expect(deriveSizing(column, registry).minHeight, `${stats} over ${list}`).toBe(want)
      expect(deriveSizing(leaf(stats), registry).height).toBe('hug')
    }
  })

  it('every block in Builder\'s row except Spacer has a minimum height', () => {
    const offered = groupPaletteBlocks(paletteBlocksOf(Object.values(registry)))
      .flatMap(g => g.items)
      .filter(item => item.blockId !== 'spacer')
    expect(offered.length).toBeGreaterThan(0)
    for (const item of offered) {
      expect(registry[item.blockId]?.minHeight ?? 0, `${item.blockId} minHeight`).toBeGreaterThan(0)
    }
  })

  it('every listed block writes sizing.height out', () => {
    // Read the entry directly: deriveSizing treats a missing height as fill.
    for (const [id, height] of Object.entries(LISTED)) {
      expect(registry[id]?.sizing?.height, `${id} sizing.height`).toBe(height)
    }
    for (const [layer, ids] of [[layoutLayer, LAYOUT_IDS], [bookingsLayer, BOOKINGS_IDS]] as const) {
      for (const id of ids) {
        expect(layer[id]?.sizing?.height, `${id} sizing.height (own layer)`).toBe(LISTED[id])
      }
    }
  })
})
