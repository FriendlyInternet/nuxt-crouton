import { describe, it, expect } from 'vitest'
import {
  getNode,
  makeLeaf,
  dropBlock,
  removeNode,
  applySizes,
  setConfig,
  setOpen,
} from '../layout-edit'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockDefinition } from '@fyit/crouton-core/app/types/layout-block'

const listDef: CroutonLayoutBlockDefinition = {
  id: 'list',
  name: 'List',
  description: 'A list',
  icon: 'i-lucide-list',
  component: 'X',
  defaultSize: 34,
}

function masterDetail(): LayoutSplit {
  return {
    type: 'split',
    direction: 'horizontal',
    children: [
      { type: 'leaf', blockId: 'list', defaultSize: 40 },
      { type: 'leaf', blockId: 'form', defaultSize: 60 },
    ],
  }
}

describe('getNode', () => {
  it('returns the root for the empty path', () => {
    const root = masterDetail()
    expect(getNode(root, [])).toBe(root)
  })
  it('walks child indices', () => {
    const root = masterDetail()
    expect(getNode(root, [1])).toMatchObject({ type: 'leaf', blockId: 'form' })
  })
  it('returns null for an out-of-range / non-split path', () => {
    expect(getNode(masterDetail(), [5])).toBeNull()
    expect(getNode(masterDetail(), [0, 0])).toBeNull() // child 0 is a leaf
    expect(getNode(null, [0])).toBeNull()
  })
})

describe('makeLeaf', () => {
  it('seeds defaultSize from the block contract', () => {
    expect(makeLeaf('list', listDef)).toEqual({ type: 'leaf', blockId: 'list', defaultSize: 34 })
  })
  it('omits defaultSize when the block declares none', () => {
    expect(makeLeaf('bare')).toEqual({ type: 'leaf', blockId: 'bare' })
  })
})

describe('dropBlock — seeding an empty tree', () => {
  it('a drop onto an empty tree creates a single leaf', () => {
    expect(dropBlock(null, [], 'list', 'center', listDef)).toEqual({
      type: 'leaf', blockId: 'list', defaultSize: 34,
    })
  })
})

describe('dropBlock — edges split the target into a nested 2-child split', () => {
  it('right edge → horizontal split, new block AFTER', () => {
    const next = dropBlock(makeLeaf('a'), [], 'b', 'right') as LayoutSplit
    expect(next.type).toBe('split')
    expect(next.direction).toBe('horizontal')
    expect(next.children.map(c => (c as any).blockId)).toEqual(['a', 'b'])
  })
  it('left edge → horizontal split, new block BEFORE', () => {
    const next = dropBlock(makeLeaf('a'), [], 'b', 'left') as LayoutSplit
    expect(next.children.map(c => (c as any).blockId)).toEqual(['b', 'a'])
  })
  it('bottom edge → vertical split', () => {
    const next = dropBlock(makeLeaf('a'), [], 'b', 'bottom') as LayoutSplit
    expect(next.direction).toBe('vertical')
    expect(next.children.map(c => (c as any).blockId)).toEqual(['a', 'b'])
  })
  it('nests when dropping on a leaf inside an existing split', () => {
    const root = masterDetail()
    const next = dropBlock(root, [1], 'stats', 'bottom') as LayoutSplit
    // child 1 (form) becomes a vertical split [form, stats]; child 0 untouched.
    expect(next.children[0]).toMatchObject({ type: 'leaf', blockId: 'list' })
    const nested = next.children[1] as LayoutSplit
    expect(nested.type).toBe('split')
    expect(nested.direction).toBe('vertical')
    expect(nested.children.map(c => (c as any).blockId)).toEqual(['form', 'stats'])
  })
  it('the new split inherits the target pane size; children share it evenly', () => {
    const root = masterDetail() // child 1 form has defaultSize 60
    const next = dropBlock(root, [1], 'stats', 'right') as LayoutSplit
    expect(next.children[1]).toMatchObject({ defaultSize: 60 }) // split keeps the slot's size
    const nested = next.children[1] as LayoutSplit
    expect((nested.children[0] as any).defaultSize).toBeUndefined() // wrapped sheds its size
  })
  it('does not mutate the input tree', () => {
    const root = masterDetail()
    const snapshot = JSON.stringify(root)
    dropBlock(root, [1], 'stats', 'right')
    expect(JSON.stringify(root)).toBe(snapshot)
  })
})

describe('dropBlock — center swaps a leaf block in place', () => {
  it('replaces the blockId and clears config', () => {
    const root: LayoutNode = { type: 'leaf', blockId: 'a', config: { heading: 'x' } }
    expect(dropBlock(root, [], 'b', 'center')).toEqual({ type: 'leaf', blockId: 'b', config: undefined })
  })
  it('is a no-op on a split (ambiguous target)', () => {
    const root = masterDetail()
    expect(dropBlock(root, [], 'b', 'center')).toBe(root)
  })
})

describe('removeNode — collapses a split down to its survivor', () => {
  it('removing one of two children replaces the split with the remaining child', () => {
    const root = masterDetail()
    const next = removeNode(root, [0]) // remove the list leaf
    expect(next).toMatchObject({ type: 'leaf', blockId: 'form' })
  })
  it('the survivor inherits the collapsed split’s outer size', () => {
    const root: LayoutSplit = { ...masterDetail(), defaultSize: 70 }
    const next = removeNode(root, [0])
    expect(next).toMatchObject({ type: 'leaf', blockId: 'form', defaultSize: 70 })
  })
  it('removing the root (empty path) empties the tree', () => {
    expect(removeNode(masterDetail(), [])).toBeNull()
    expect(removeNode(null, [0])).toBeNull()
  })
  it('a nested removal keeps siblings intact', () => {
    // [list, [form, stats]] → remove stats → [list, form]
    const root: LayoutSplit = {
      type: 'split', direction: 'horizontal',
      children: [
        { type: 'leaf', blockId: 'list' },
        { type: 'split', direction: 'vertical', defaultSize: 60, children: [
          { type: 'leaf', blockId: 'form' },
          { type: 'leaf', blockId: 'stats' },
        ] },
      ],
    }
    const next = removeNode(root, [1, 1]) as LayoutSplit
    expect(next.children[0]).toMatchObject({ blockId: 'list' })
    expect(next.children[1]).toMatchObject({ type: 'leaf', blockId: 'form', defaultSize: 60 })
  })
})

describe('applySizes — persists resize results onto a split', () => {
  it('writes each child defaultSize', () => {
    const root = masterDetail()
    const next = applySizes(root, [], [30, 70]) as LayoutSplit
    expect(next.children.map(c => c.defaultSize)).toEqual([30, 70])
  })
  it('is a no-op when the path is not a split', () => {
    const root = masterDetail()
    expect(applySizes(root, [0], [10, 90])).toBe(root)
  })
})

describe('setConfig — writes per-block config on a leaf', () => {
  it('sets config on the addressed leaf only', () => {
    const root = masterDetail()
    const next = setConfig(root, [0], { heading: 'Bookings' }) as LayoutSplit
    expect(next.children[0]).toMatchObject({ blockId: 'list', config: { heading: 'Bookings' } })
    expect(next.children[1]).toMatchObject({ blockId: 'form' })
  })
  it('is a no-op on a split node', () => {
    const root = masterDetail()
    expect(setConfig(root, [], { x: 1 })).toBe(root)
  })
})

describe('setOpen — persists a collapsible pane’s open/closed state', () => {
  function collapsibleDetail(): LayoutSplit {
    return {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', blockId: 'pos', defaultSize: 60 },
        { type: 'leaf', blockId: 'orders', defaultSize: 40, collapsible: true, collapse: 'gutter-tabs', open: true },
      ],
    }
  }

  it('sets open=false on the addressed pane (collapse it)', () => {
    const root = collapsibleDetail()
    const next = setOpen(root, [1], false) as LayoutSplit
    expect(next.children[1]).toMatchObject({ blockId: 'orders', collapsible: true, open: false })
  })

  it('sets open=true on the addressed pane (re-open it)', () => {
    const root: LayoutSplit = {
      type: 'split', direction: 'horizontal',
      children: [
        { type: 'leaf', blockId: 'pos' },
        { type: 'leaf', blockId: 'orders', collapsible: true, open: false },
      ],
    }
    const next = setOpen(root, [1], true) as LayoutSplit
    expect(next.children[1]).toMatchObject({ blockId: 'orders', open: true })
  })

  it('only touches the addressed node; siblings + sizes untouched', () => {
    const root = collapsibleDetail()
    const next = setOpen(root, [1], false) as LayoutSplit
    expect(next.children[0]).toMatchObject({ blockId: 'pos', defaultSize: 60 })
    expect(next.children[1]).toMatchObject({ defaultSize: 40, collapse: 'gutter-tabs' })
  })

  it('can set open on the root node (empty path)', () => {
    const root: LayoutNode = { type: 'leaf', blockId: 'orders', collapsible: true, open: true }
    expect(setOpen(root, [], false)).toMatchObject({ blockId: 'orders', open: false })
  })

  it('is a no-op for a non-existent path', () => {
    const root = collapsibleDetail()
    expect(setOpen(root, [5], false)).toBe(root)
  })

  it('does not mutate the input tree', () => {
    const root = collapsibleDetail()
    const snapshot = JSON.stringify(root)
    setOpen(root, [1], false)
    expect(JSON.stringify(root)).toBe(snapshot)
  })
})
