import { describe, it, expect, beforeAll } from 'vitest'
import type { CroutonLayoutBlockDefinition, CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { groupPaletteBlocks } from '../app/utils/palette-groups'

// Builder's REAL block list: crouton-layout's defaults merged with Builder's own
// registry, as the running app sees them (useCroutonLayoutBlocks → blocksList).
let blocksList: CroutonLayoutBlockDefinition[] = []

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).defineAppConfig = (c: unknown) => c
  const layout = (await import('../../../packages/crouton-layout/app/app.config')).default as { croutonLayoutBlocks: CroutonLayoutBlockRegistry }
  const builder = (await import('../app/app.config')).default as { croutonLayoutBlocks: CroutonLayoutBlockRegistry }
  blocksList = Object.values({ ...layout.croutonLayoutBlocks, ...builder.croutonLayoutBlocks })
})

const shape = (list: CroutonLayoutBlockDefinition[]) =>
  groupPaletteBlocks(list).map(g => [g.label, g.items.map(i => i.label)])

describe('groupPaletteBlocks — Builder block row (#3748)', () => {
  it('groups Builder\'s real blocks into Artists, Bookings, Layout (in that order)', () => {
    expect(shape(blocksList)).toEqual([
      ['Artists', ['List', 'Form', 'Stats']],
      ['Bookings', ['List']],
      ['Layout', ['Top bar', 'Bottom nav', 'Spacer']],
    ])
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
    expect(groups.find(g => g.label === 'Bookings')!.collection).toBe('builderBookings')
    expect(groups.find(g => g.label === 'Layout')!.collection).toBeNull()
  })

  it('every block offered is linked to a collection or is a layout piece', () => {
    for (const g of groupPaletteBlocks(blocksList)) {
      if (g.label !== 'Layout') expect(g.collection).toBeTruthy()
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
