import { describe, it, expect } from 'vitest'
import {
  composeSplitterItems,
  editorSplitterItems,
  splitterHandleClass,
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
