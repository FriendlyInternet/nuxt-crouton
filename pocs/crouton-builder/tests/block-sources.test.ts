/**
 * #3651 — the builder seeds `source: 'bookings'` on the bookings blocks it places
 * (they take props only and are fed by the `bookings` layout store), and the
 * served page fills it in for older saved pages.
 */
import { describe, expect, it } from 'vitest'
import type { LayoutLeaf, LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { withBlockSources } from '../app/utils/block-sources'

const leaf = (blockId: string, source?: string): LayoutLeaf => ({ type: 'leaf', blockId, ...(source ? { source } : {}) })

describe('withBlockSources (#3651)', () => {
  // covers: T10
  it('gives a bookings block at the root its source', () => {
    expect(withBlockSources(leaf('bookings-package-list'))).toEqual({ type: 'leaf', blockId: 'bookings-package-list', source: 'bookings' })
  })

  // covers: T10
  it('fills sources inside a split and inside a nested layout', () => {
    const tree: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        leaf('bookings-locations'),
        {
          type: 'nested',
          layout: { renderer: 'panes', root: { type: 'split', direction: 'vertical', children: [leaf('bookings-filters'), leaf('bookings-package-list')] } },
        },
      ],
    }
    const out = withBlockSources(tree) as any
    expect(out.children[0].source).toBe('bookings')
    expect(out.children[1].layout.root.children.map((c: LayoutLeaf) => c.source)).toEqual(['bookings', 'bookings'])
  })

  // covers: T10
  it('keeps an existing source and leaves other blocks without one', () => {
    const out = withBlockSources({ type: 'split', direction: 'horizontal', children: [leaf('bookings-package-list', 'bookings#mine'), leaf('artists-list')] }) as any
    expect(out.children[0].source).toBe('bookings#mine')
    expect(out.children[1]).toEqual({ type: 'leaf', blockId: 'artists-list' })
    expect('source' in out.children[1]).toBe(false)
  })
})
