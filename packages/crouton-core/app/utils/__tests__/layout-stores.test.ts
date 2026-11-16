/**
 * collectLayoutStores (#3650) — the full list of store copies a layout needs.
 */
import { describe, it, expect } from 'vitest'
import { collectLayoutStores } from '../layout-stores'
import type { LayoutTree } from '../../types/layout'

const leaf = (blockId: string, source?: string) => ({ type: 'leaf' as const, blockId, ...(source ? { source } : {}) })

describe('collectLayoutStores', () => {
  it('(a) lists sources from the root, a breakpoint root and a nested sub-layout', () => {
    const tree: LayoutTree = {
      renderer: 'panes',
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [
          leaf('a', 'root-src'),
          { type: 'nested', layout: { renderer: 'panes', root: leaf('b', 'nested-src'), breakpoints: [{ minWidth: 500, root: leaf('c', 'nested-bp-src') }] } },
          leaf('plain'),
        ],
      },
      breakpoints: [{ minWidth: 800, root: leaf('d', 'bp-src') }, { minWidth: 1000 }],
    }
    expect(collectLayoutStores(tree).map(s => s.source)).toEqual(['bp-src', 'nested-bp-src', 'nested-src', 'root-src'])
  })

  it('(b) lists a `sources` key that no leaf uses', () => {
    const tree: LayoutTree = { renderer: 'panes', root: leaf('a'), sources: { orphan: { options: { x: 1 } } } }
    expect(collectLayoutStores(tree)).toEqual([{ source: 'orphan', options: { x: 1 } }])
  })

  it('(c) outer options win over nested ones', () => {
    const tree: LayoutTree = {
      renderer: 'panes',
      root: {
        type: 'nested',
        layout: { renderer: 'panes', root: leaf('a', 'shared'), sources: { shared: { options: { who: 'inner' } }, innerOnly: { options: { who: 'inner' } } } },
      },
      sources: { shared: { options: { who: 'outer' } } },
    }
    expect(collectLayoutStores(tree)).toEqual([
      { source: 'innerOnly', options: { who: 'inner' } },
      { source: 'shared', options: { who: 'outer' } },
    ])
  })

  it('(d) gives the same output for reordered children and breakpoints', () => {
    const a: LayoutTree = {
      renderer: 'panes',
      root: { type: 'split', direction: 'vertical', children: [leaf('x', 'one'), leaf('y', 'two')] },
      breakpoints: [{ minWidth: 300, root: leaf('z', 'three') }, { minWidth: 900, root: leaf('w', 'four') }],
    }
    const b: LayoutTree = {
      renderer: 'panes',
      root: { type: 'split', direction: 'vertical', children: [leaf('y', 'two'), leaf('x', 'one')] },
      breakpoints: [{ minWidth: 900, root: leaf('w', 'four') }, { minWidth: 300, root: leaf('z', 'three') }],
    }
    expect(collectLayoutStores(a)).toEqual(collectLayoutStores(b))
  })

  it('(e) `bookings` and `bookings#mine` come out as two entries', () => {
    const tree: LayoutTree = {
      renderer: 'panes',
      root: { type: 'split', direction: 'horizontal', children: [leaf('a', 'bookings'), leaf('b', 'bookings#mine'), leaf('c', 'bookings')] },
    }
    expect(collectLayoutStores(tree)).toEqual([{ source: 'bookings' }, { source: 'bookings#mine' }])
  })
})
