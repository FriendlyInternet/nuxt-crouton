import { describe, it, expect } from 'vitest'
import {
  composeSplitterItems,
  editorSplitterItems,
  splitterHandleClass,
  rendererSplitterItems,
  rendererHandleClass,
  collapseAction,
} from '../layout-splitter-items'
import { panelMinSizePct } from '../layout-viability'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'

const leaf = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode =>
  ({ id, type: 'leaf', blockId: id, ...extra } as LayoutNode)

const split = (children: LayoutNode[], direction: 'horizontal' | 'vertical' = 'horizontal'): LayoutSplit =>
  ({ id: 's', type: 'split', direction, children } as LayoutSplit)

describe('composeSplitterItems', () => {
  it('uses the authored defaultSize', () => {
    const items = composeSplitterItems(split([leaf('a', { defaultSize: 30 }), leaf('b', { defaultSize: 70 })]))
    expect(items.map(i => i.defaultSize)).toEqual([30, 70])
  })

  it('falls back to an equal share per child (not renormalised)', () => {
    expect(composeSplitterItems(split([leaf('a'), leaf('b'), leaf('c')])).map(i => i.defaultSize))
      .toEqual([100 / 3, 100 / 3, 100 / 3])
    expect(composeSplitterItems(split([leaf('a', { defaultSize: 50 }), leaf('b'), leaf('c')])).map(i => i.defaultSize))
      .toEqual([50, 100 / 3, 100 / 3])
  })

  it('carries no minSize, even when a child has an authored minSize', () => {
    const items = composeSplitterItems(split([leaf('a', { minSize: 20 }), leaf('b')]))
    for (const item of items) expect('minSize' in item).toBe(false)
  })

  it('has no id, and a shared pane slot, overflow-hidden class and block panel', () => {
    for (const item of composeSplitterItems(split([leaf('a'), leaf('b')]))) {
      expect('id' in item).toBe(false)
      expect(item.slot).toBe('pane')
      expect(item.class).toBe('overflow-hidden')
      expect(item.ui?.panel).toBe('block')
    }
  })

  it('returns new objects each call', () => {
    const s = split([leaf('a'), leaf('b')])
    const first = composeSplitterItems(s)
    first[0]!.ui!.panel = 'flex'
    first[0]!.defaultSize = 1
    const second = composeSplitterItems(s)
    expect(second[0]!.ui?.panel).toBe('block')
    expect(second[0]!.defaultSize).toBe(50)
    expect(second[0]!.ui).not.toBe(first[0]!.ui)
  })
})

describe('editorSplitterItems', () => {
  it('sets minSize per child in order, keeping the compose defaultSize', () => {
    const s = split([leaf('a', { defaultSize: 30 }), leaf('b', { defaultSize: 70 })])
    const mins = [10, 25]
    const items = editorSplitterItems(s, child => mins[s.children.indexOf(child)]!)
    expect(items.map(i => i.minSize)).toEqual([10, 25])
    expect(items.map(i => i.defaultSize)).toEqual([30, 70])
    const fallback = editorSplitterItems(split([leaf('a'), leaf('b'), leaf('c')]), () => 0)
    expect(fallback.map(i => i.defaultSize)).toEqual([100 / 3, 100 / 3, 100 / 3])
  })

  it('ties to the real panelMinSizePct floor maths', () => {
    const minWidthFor = (id: string) => (id === 'wide' ? 300 : 0)
    const h = split([leaf('wide'), leaf('b', { minSize: 5 })], 'horizontal')
    expect(editorSplitterItems(h, c => panelMinSizePct('horizontal', c, 1000, minWidthFor)).map(i => i.minSize))
      .toEqual([30, 5])
    const v = split([leaf('wide', { minSize: 12 }), leaf('b')], 'vertical')
    expect(editorSplitterItems(v, c => panelMinSizePct('vertical', c, 1000, minWidthFor)).map(i => i.minSize))
      .toEqual([12, 0])
  })
})

describe('splitterHandleClass', () => {
  it('maps orientation + thickness to a plain width/height utility', () => {
    const h = splitterHandleClass('horizontal', 'px')
    expect(h).toContain('w-px')
    expect(h).not.toContain('h-')
    expect(splitterHandleClass('vertical', '1')).toContain('h-1')
    expect(splitterHandleClass('horizontal', '1')).toBe('w-1')
    expect(splitterHandleClass('vertical', 'px')).toBe('h-px')
  })
})

describe('rendererSplitterItems', () => {
  const minWidthFor = (id: string) => (id === 'wide' ? 300 : 0)
  const floor = (c: LayoutNode) => panelMinSizePct('horizontal', c, 1000, minWidthFor)

  it('without a collapse context: editor sizes + floors, no collapse keys', () => {
    const s = split([leaf('wide', { defaultSize: 40 }), leaf('b', { minSize: 5 })])
    const items = rendererSplitterItems(s, floor, null)
    expect(items.map(i => i.defaultSize)).toEqual([40, 50])
    expect(items.map(i => i.minSize)).toEqual([30, 5])
    for (const item of items) {
      expect('collapsible' in item).toBe(false)
      expect('collapsedSize' in item).toBe(false)
      expect('id' in item).toBe(false)
      expect(item.class).toBe('overflow-hidden')
      expect(item.ui?.panel).toBe('block')
      expect(item.slot).toBe('pane')
    }
  })

  it('in-place collapse: the collapsed child is pinned to pct, all are collapsible with the style class', () => {
    const s = split([leaf('wide', { defaultSize: 40 }), leaf('b', { defaultSize: 60, minSize: 5 })])
    const items = rendererSplitterItems(s, floor, { collapsed: [true, false], pct: 6, style: 'spring-drawer' })
    expect(items[0]).toMatchObject({ defaultSize: 6, minSize: 6, collapsible: true, collapsedSize: 6 })
    expect(items[1]).toMatchObject({ defaultSize: 60, minSize: 5, collapsible: true, collapsedSize: 6 })
    for (const item of items) {
      expect(item.class).toContain('mq-co-spring-drawer')
      expect(item.class).toContain('overflow-hidden')
    }
  })

  it('in-place with nothing collapsed: sizes + floors equal the no-collapse case (expand-back)', () => {
    const s = split([leaf('wide', { defaultSize: 40 }), leaf('b', { minSize: 5 })])
    const plain = rendererSplitterItems(s, floor, null)
    const items = rendererSplitterItems(s, floor, { collapsed: [false, false], pct: 6, style: 'iris-portal' })
    expect(items.map(i => i.defaultSize)).toEqual(plain.map(i => i.defaultSize))
    expect(items.map(i => i.minSize)).toEqual(plain.map(i => i.minSize))
    for (const item of items) {
      expect(item.collapsible).toBe(true)
      expect(item.collapsedSize).toBe(6)
    }
  })

  it('returns new objects each call', () => {
    const s = split([leaf('a'), leaf('b')])
    const ctx = { collapsed: [false, false], pct: 6, style: 'spring-drawer' }
    const first = rendererSplitterItems(s, () => 0, ctx)
    first[0]!.ui!.panel = 'flex'
    const second = rendererSplitterItems(s, () => 0, ctx)
    expect(second[0]!.ui?.panel).toBe('block')
    expect(second[0]!.ui).not.toBe(first[0]!.ui)
  })
})

describe('rendererHandleClass', () => {
  it('interactive: the 1px bordered divider per orientation', () => {
    const h = rendererHandleClass('horizontal', true)
    expect(h).toContain('w-px')
    expect(h).toContain('bg-border')
    expect(h).toContain('hover:bg-primary')
    expect(rendererHandleClass('vertical', true)).toContain('h-px')
  })

  it('not interactive: hidden in both directions (view-only in-place collapse has no seam)', () => {
    expect(rendererHandleClass('horizontal', false)).toBe('hidden')
    expect(rendererHandleClass('vertical', false)).toBe('hidden')
    // View-only in-place collapse still gets collapsible items (paired with the hidden handle).
    const items = rendererSplitterItems(split([leaf('a'), leaf('b')]), () => 0, { collapsed: [true, false], pct: 6, style: 'crt-power-down' })
    expect(items.every(i => i.collapsible === true && i.collapsedSize === 6)).toBe(true)
  })
})

describe('collapseAction', () => {
  it('collapses / expands only when the wanted state differs from the live one', () => {
    expect(collapseAction(true, false)).toBe('collapse')
    expect(collapseAction(false, true)).toBe('expand')
    expect(collapseAction(true, true)).toBeNull()
    expect(collapseAction(false, false)).toBeNull()
  })

  it('never touches a panel with no collapse context', () => {
    expect(collapseAction(undefined, true)).toBeNull()
    expect(collapseAction(undefined, false)).toBeNull()
  })
})
