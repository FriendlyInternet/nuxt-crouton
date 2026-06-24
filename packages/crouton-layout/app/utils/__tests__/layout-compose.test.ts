import { describe, it, expect } from 'vitest'
import { composeDefaultLayout } from '../layout-compose'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import type { LayoutSplit, LayoutLeaf } from '@fyit/crouton-core/app/types/layout'

/** A registry mirroring the real core + bookings sizing contracts. */
const registry: CroutonLayoutBlockRegistry = {
  'collection-list': {
    id: 'collection-list', name: 'List', description: '', icon: 'i-lucide-list',
    component: 'CroutonLayoutCollection', minWidth: 260, defaultSize: 34,
  },
  'entity-form': {
    id: 'entity-form', name: 'Form', description: '', icon: 'i-lucide-square-pen',
    component: 'CroutonLayoutForm', minWidth: 320, defaultSize: 50,
  },
  'bookings-calendar': {
    id: 'bookings-calendar', name: 'Calendar', description: '', icon: 'i-lucide-calendar',
    component: 'CroutonBookingsLayoutCalendar', minWidth: 520, defaultSize: 65,
  },
}

/** Registry without the form block (only a list). */
const listOnly: CroutonLayoutBlockRegistry = { 'collection-list': registry['collection-list']! }
/** Registry without the list block (only a form). */
const formOnly: CroutonLayoutBlockRegistry = { 'entity-form': registry['entity-form']! }

describe('composeDefaultLayout — master/detail', () => {
  it('places a single collection as a viable horizontal list + form', () => {
    const r = composeDefaultLayout({ collections: [{ key: 'mainItems', label: 'Items' }], registry })
    expect(r.pattern).toBe('master-detail')
    expect(r.viable).toBe(true)
    const root = r.tree.root as LayoutSplit
    expect(root.type).toBe('split')
    expect(root.direction).toBe('horizontal')
    const [list, form] = root.children as LayoutLeaf[]
    expect(list!.blockId).toBe('collection-list')
    expect(form!.blockId).toBe('entity-form')
    // Each leaf is data-bound to the collection (the whole point of Sprint 4).
    expect(list!.config).toMatchObject({ collection: 'mainItems' })
    expect(form!.config).toMatchObject({ collection: 'mainItems' })
  })

  it('falls back to a vertical stack when the side-by-side split is too narrow', () => {
    const r = composeDefaultLayout({
      collections: [{ key: 'mainItems' }], registry, targetWidths: [375],
    })
    expect(r.pattern).toBe('master-detail')
    expect(r.viable).toBe(true)
    expect((r.tree.root as LayoutSplit).direction).toBe('vertical')
  })

  it('reports non-viable when even the vertical stack cannot satisfy a min-width', () => {
    const tooWide: CroutonLayoutBlockRegistry = {
      'collection-list': { ...registry['collection-list']!, minWidth: 900 },
      'entity-form': registry['entity-form']!,
    }
    const r = composeDefaultLayout({ collections: [{ key: 'x' }], registry: tooWide, targetWidths: [768] })
    expect(r.viable).toBe(false)
    expect(r.violations.some(v => v.blockId === 'collection-list')).toBe(true)
  })
})

describe('composeDefaultLayout — calendar-primary', () => {
  it('uses the calendar when a collection declares one (stacks it on top when too narrow)', () => {
    const r = composeDefaultLayout({
      collections: [{ key: 'bookingsBookings', calendar: true }], registry,
    })
    expect(r.pattern).toBe('calendar-primary')
    expect(r.viable).toBe(true)
    const root = r.tree.root as LayoutSplit
    // At [1280, 768] the calendar can't sit beside the list (768 too narrow) → vertical, calendar first.
    expect(root.direction).toBe('vertical')
    expect((root.children[0] as LayoutLeaf).blockId).toBe('bookings-calendar')
  })

  it('keeps the calendar beside the list on a wide-only target', () => {
    const r = composeDefaultLayout({
      collections: [{ key: 'bookingsBookings', calendar: true }], registry, targetWidths: [1280],
    })
    expect(r.pattern).toBe('calendar-primary')
    const root = r.tree.root as LayoutSplit
    expect(root.direction).toBe('horizontal')
    const ids = (root.children as LayoutLeaf[]).map(c => c.blockId)
    expect(ids).toContain('bookings-calendar')
    expect(ids).toContain('collection-list')
  })
})

describe('composeDefaultLayout — extras & degenerate cases', () => {
  it('stacks additional collections as list panes below the primary surface', () => {
    const r = composeDefaultLayout({
      collections: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], registry,
    })
    expect(r.pattern).toBe('master-detail')
    const root = r.tree.root as LayoutSplit
    expect(root.direction).toBe('vertical')
    // primary master/detail + two extra list panes
    expect(root.children).toHaveLength(3)
    expect((root.children[0] as LayoutSplit).type).toBe('split')
    expect((root.children[1] as LayoutLeaf).config).toMatchObject({ collection: 'b' })
    expect((root.children[2] as LayoutLeaf).config).toMatchObject({ collection: 'c' })
    expect(r.viable).toBe(true)
  })

  it('falls back to form-centric when only a form block is registered', () => {
    const r = composeDefaultLayout({ collections: [{ key: 'settings' }], registry: formOnly })
    expect(r.pattern).toBe('form-centric')
    expect((r.tree.root as LayoutLeaf).blockId).toBe('entity-form')
  })

  it('falls back to a single list when only a list block is registered', () => {
    const r = composeDefaultLayout({ collections: [{ key: 'items' }], registry: listOnly })
    expect(r.pattern).toBe('stacked')
    expect((r.tree.root as LayoutLeaf).blockId).toBe('collection-list')
  })

  it('returns an empty pattern when there are no collections', () => {
    const r = composeDefaultLayout({ collections: [], registry })
    expect(r.pattern).toBe('empty')
    expect(r.tree.root.type).toBe('leaf')
  })
})
