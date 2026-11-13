import { describe, it, expect, beforeAll } from 'vitest'
import type { CroutonLayoutBlockDefinition, CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { existsSync } from 'node:fs'
import { defuFn } from 'defu'
import { fileURLToPath } from 'node:url'
import { groupPaletteBlocks, offerable } from '../app/utils/palette-groups'
import { paletteBlocksOf } from '../app/utils/palette-blocks'
import { parseLayoutTree } from '../../../packages/crouton-layout/app/utils/layout-serialize'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'

// Builder's REAL block list, as the running app sees it (useCroutonLayoutBlocks →
// blocksList): the same `defuFn(app, core, layout, bookings)` merge Nuxt writes into
// `.nuxt/app.config.mjs` (see bookings-blocks.test.ts). A plain spread isn't enough —
// Builder's config overrides some package blocks by name only and uses the function
// form for one `configSchema`, which only the real merge resolves (#2559).
let blocksList: CroutonLayoutBlockDefinition[] = []

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).defineAppConfig = (c: unknown) => c
  const layers = await Promise.all([
    import('../app/app.config'),
    import('../../../packages/crouton-core/app/app.config'),
    import('../../../packages/crouton-layout/app/app.config'),
    import('../../../packages/crouton-bookings/app/app.config'),
  ])
  const merged = defuFn(...(layers.map(m => m.default) as [object, ...object[]])) as { croutonLayoutBlocks: CroutonLayoutBlockRegistry }
  blocksList = Object.values(merged.croutonLayoutBlocks)
})

const shape = (list: CroutonLayoutBlockDefinition[]) =>
  groupPaletteBlocks(list).map(g => [g.label, g.items.map(i => i.label)])

describe('groupPaletteBlocks — Builder block row (#3748)', () => {
  it('groups Builder\'s real blocks into Artists, Bookings, Gigs, Layout (in that order)', () => {
    // Bookings = @fyit/crouton-bookings' atomic blocks (#2559); its compound all-in-one
    // Calendar and its Filters block are not offered. Gigs = the demo builderBookings.
    // Same input the editor's row gets: groupPaletteBlocks(paletteBlocksOf(blocksList)).
    expect(shape(paletteBlocksOf(blocksList))).toEqual([
      ['Artists', ['List', 'Form', 'Stats']],
      ['Bookings', ['Calendar', 'Locations', 'Bookings list']],
      ['Gigs', ['List']],
      ['Layout', ['Top bar', 'Bottom nav', 'Spacer']],
    ])
    const ids = groupPaletteBlocks(paletteBlocksOf(blocksList)).flatMap(g => g.items.map(i => i.blockId))
    expect(ids).not.toContain('bookings-calendar')
    expect(ids).not.toContain('bookings-filters')
    // Both stay registered, so a saved page that holds one still renders.
    expect(blocksList.map(b => b.id)).toEqual(expect.arrayContaining(['bookings-calendar', 'bookings-filters']))
  })

  it('leaves the unlinked generic blocks and the drop preview out of the row', () => {
    const ids = groupPaletteBlocks(blocksList).flatMap(g => g.items.map(i => i.blockId))
    for (const id of ['collection-list', 'entity-form', 'stats', '__dropghost__']) expect(ids).not.toContain(id)
    // …while they stay registered, so existing pages still render them.
    expect(blocksList.map(b => b.id)).toEqual(expect.arrayContaining(['collection-list', 'entity-form', 'stats']))
  })

  it('binds each collection group to its collection and takes its first block\'s icon', () => {
    const groups = groupPaletteBlocks(blocksList)
    const artists = groups.find(g => g.label === 'Artists')!
    expect(artists.collection).toBe('builderArtists')
    expect(artists.icon).toBe('i-lucide-list')
    expect(groups.find(g => g.label === 'Gigs')!.collection).toBe('builderBookings')
    expect(groups.find(g => g.label === 'Layout')!.collection).toBeNull()
  })

  it('every block offered is linked to a collection or is a layout piece', () => {
    // Exception: the bookings package's blocks (#2559, the Bookings group) fetch their own data and have
    // no `collection` field at all — self-contained, like Artists · Stats.
    const byId = new Map(blocksList.map(b => [b.id, b]))
    for (const g of groupPaletteBlocks(blocksList)) {
      if (g.label === 'Layout') continue
      if (g.label === 'Bookings') {
        for (const i of g.items) expect(byId.get(i.blockId)!.configSchema?.some(f => f.name === 'collection'), i.blockId).toBe(false)
        continue
      }
      expect(g.collection, g.label).toBeTruthy()
    }
  })

  it('checks the rule per BLOCK: no offered block needs a collection it doesn\'t have', () => {
    const byId = new Map(blocksList.map(b => [b.id, b]))
    for (const item of groupPaletteBlocks(blocksList).flatMap(g => g.items)) {
      const def = byId.get(item.blockId)!
      const needs = !!def.configSchema?.some(f => f.name === 'collection')
      const has = def.configSchema?.find(f => f.name === 'collection')?.default || def.defaultConfig?.collection
      expect(def.category === 'chrome' || !needs || !!has, `${def.id} would show "Configure a collection"`).toBe(true)
    }
  })

  it('drops a block named into a linked group when it needs a collection and has none', () => {
    const def = (id: string, name: string, collection?: string): CroutonLayoutBlockDefinition => ({
      id, name, category: 'data', component: 'CroutonLayoutForm', kind: 'atomic',
      configSchema: [{ name: 'collection', type: 'text', label: 'Collection', default: collection ?? '' }],
    }) as CroutonLayoutBlockDefinition
    const unlinked = def('artists-x', 'Artists · X')
    expect(offerable(unlinked)).toBe(false)
    // Its linked sibling keeps the group's collection — the old per-group check would pass this.
    expect(shape([def('artists-list', 'Artists · List', 'builderArtists'), unlinked]))
      .toEqual([['Artists', ['List']]])
  })

  it('an existing page that uses a plain Form block still resolves to a real component', () => {
    // A page saved before #3748, with the generic entity-form beside an Artists list.
    const stored = JSON.stringify({
      renderer: 'panes',
      root: { type: 'split', direction: 'horizontal', children: [
        { type: 'leaf', id: 'a', blockId: 'artists-list' },
        { type: 'leaf', id: 'b', blockId: 'entity-form', config: { collection: 'builderArtists' } },
      ] },
    })
    const tree = parseLayoutTree(stored)
    expect(tree).not.toBeNull()
    const leaves: string[] = []
    const walk = (n: LayoutNode) => (n.type === 'leaf' ? leaves.push(n.blockId) : n.children.forEach(walk))
    walk(tree!.root)
    expect(leaves).toContain('entity-form')
    // Each leaf resolves in the merged registry to a component file that exists
    // (`CroutonLayoutForm` → crouton-layout's components/LayoutForm.vue).
    const registry = new Map(blocksList.map(b => [b.id, b]))
    for (const id of leaves) {
      const component = registry.get(id)?.component
      expect(component, id).toMatch(/^CroutonLayout/)
      const file = fileURLToPath(new URL(`../../../packages/crouton-layout/app/components/${component!.replace(/^Crouton/, '')}.vue`, import.meta.url))
      expect(existsSync(file), file).toBe(true)
    }
  })

  it('sorts collections alphabetically whatever the registry order, Layout last', () => {
    const def = (id: string, name: string, category = 'data'): CroutonLayoutBlockDefinition =>
      ({ id, name, category, component: 'X', kind: 'atomic' }) as CroutonLayoutBlockDefinition
    expect(groupPaletteBlocks([
      def('sp', 'Spacer', 'chrome'), def('z', 'Zebras · List'), def('a', 'Apes · Form'),
    ]).map(g => g.label)).toEqual(['Apes', 'Zebras', 'Layout'])
  })
})
