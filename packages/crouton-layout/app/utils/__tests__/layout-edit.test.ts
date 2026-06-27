import { describe, it, expect } from 'vitest'
import {
  getNode,
  makeLeaf,
  dropBlock,
  dropNode,
  moveNode,
  detachNode,
  nestInside,
  findNodePath,
  removeNode,
  applySizes,
  setConfig,
  setCollapseRecipe,
  makeNested,
  getNestedLayout,
  replaceNestedLayout,
  findNestedNodes,
} from '../layout-edit'
import type { LayoutNode, LayoutLeaf, LayoutSplit, LayoutTree } from '@fyit/crouton-core/app/types/layout'
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

describe('setCollapseRecipe — per-pane tuck edge + affordance (#852)', () => {
  it('sets the recipe on the matching leaf only, by blockId', () => {
    const root = masterDetail()
    const next = setCollapseRecipe(root, 'list', { edge: 'left', affordance: 'tab' }) as LayoutSplit
    expect(next.children[0]).toMatchObject({ blockId: 'list', collapse: { edge: 'left', affordance: 'tab' } })
    expect(next.children[1]).not.toHaveProperty('collapse')
  })
  it('recurses into nested sub-layouts', () => {
    const root: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', blockId: 'keep' },
        { type: 'nested', label: 'App', layout: { renderer: 'panes', root: { type: 'leaf', blockId: 'inner' } } },
      ],
    }
    const next = setCollapseRecipe(root, 'inner', { edge: 'bottom', affordance: 'dot' }) as LayoutSplit
    const nested = next.children[1] as { layout: LayoutTree }
    expect(nested.layout.root).toMatchObject({ blockId: 'inner', collapse: { edge: 'bottom', affordance: 'dot' } })
  })
})

describe('nested layouts — a pane can be a whole sub-layout (WS2 #871)', () => {
  const appLayout: LayoutTree = {
    renderer: 'panes',
    root: { type: 'split', direction: 'vertical', children: [
      { type: 'leaf', blockId: 'list' },
      { type: 'leaf', blockId: 'form' },
    ] },
  }
  const page = (): LayoutNode => ({
    type: 'split', direction: 'horizontal',
    children: [makeNested(appLayout, 'Bookings'), { type: 'leaf', blockId: 'stats' }],
  })

  it('makeNested wraps a sub-layout as an app boundary', () => {
    expect(makeNested(appLayout, 'Bookings')).toEqual({ type: 'nested', layout: appLayout, label: 'Bookings' })
    expect(makeNested(appLayout)).toEqual({ type: 'nested', layout: appLayout })
  })

  it('a nested node is opaque to the parent path space (each layout edits in its own)', () => {
    const root = page()
    expect(getNode(root, [0])).toMatchObject({ type: 'nested' })
    // can't address INTO the sub-layout via the parent's path
    expect(getNode(root, [0, 0])).toBeNull()
  })

  it('getNestedLayout resolves the sub-layout at a path (null off a non-nested node)', () => {
    const root = page()
    expect(getNestedLayout(root, [0])).toEqual(appLayout)
    expect(getNestedLayout(root, [1])).toBeNull()
  })

  it('replaceNestedLayout swaps a sub-layout, leaving siblings intact', () => {
    const root = page()
    // edit the sub-layout in its OWN path space, then write it back
    const editedRoot = dropBlock(appLayout.root, [0], 'kpi', 'bottom')
    const editedTree: LayoutTree = { renderer: 'panes', root: editedRoot }
    const next = replaceNestedLayout(root, [0], editedTree) as LayoutSplit
    expect(next.children[0]).toMatchObject({ type: 'nested', layout: editedTree })
    expect(next.children[1]).toMatchObject({ type: 'leaf', blockId: 'stats' })
  })

  it('replaceNestedLayout is a no-op off a non-nested node', () => {
    const root = page()
    expect(replaceNestedLayout(root, [1], appLayout)).toBe(root)
  })

  it('dropBlock on an edge gives a nested app a sibling (wraps it in a split)', () => {
    const next = dropBlock(makeNested(appLayout), [], 'stats', 'right') as LayoutSplit
    expect(next.type).toBe('split')
    expect(next.children[0]).toMatchObject({ type: 'nested' })
    expect(next.children[1]).toMatchObject({ type: 'leaf', blockId: 'stats' })
  })

  it('removeNode removes a nested app from a page', () => {
    expect(removeNode(page(), [0])).toMatchObject({ type: 'leaf', blockId: 'stats' })
  })

  it('does not mutate inputs when editing a nested sub-layout', () => {
    const root = page()
    const snapshot = JSON.stringify(root)
    replaceNestedLayout(root, [0], { renderer: 'panes', root: { type: 'leaf', blockId: 'x' } })
    expect(JSON.stringify(root)).toBe(snapshot)
  })

  it('findNestedNodes lists the nested apps in this layout, with paths + labels', () => {
    const root: LayoutNode = {
      type: 'split', direction: 'horizontal',
      children: [
        makeNested(appLayout, 'Bookings'),
        { type: 'leaf', blockId: 'stats' },
        { type: 'split', direction: 'vertical', children: [
          { type: 'leaf', blockId: 'list' },
          makeNested(appLayout), // unlabelled, deeper
        ] },
      ],
    }
    expect(findNestedNodes(root)).toEqual([
      { path: [0], label: 'Bookings' },
      { path: [2, 1] },
    ])
  })

  it('findNestedNodes stops at a nested boundary (does not cross into its sub-layout)', () => {
    // appLayout itself contains no nested nodes, but even if it did, a parent
    // nested node must be reported as ONE target, not recursed into.
    const nestedWithNestedInside: LayoutTree = {
      renderer: 'panes',
      root: makeNested({ renderer: 'panes', root: makeNested(appLayout, 'inner') }, 'outer'),
    }
    expect(findNestedNodes(nestedWithNestedInside.root)).toEqual([{ path: [], label: 'outer' }])
  })

  it('findNestedNodes returns nothing for a plain leaf/split and handles null', () => {
    expect(findNestedNodes(null)).toEqual([])
    expect(findNestedNodes({ type: 'leaf', blockId: 'x' })).toEqual([])
    expect(findNestedNodes(masterDetail())).toEqual([])
  })
})

// --- Compose gestures (WS4 #873) -------------------------------------------
const leaf = (blockId: string, extra: Partial<LayoutLeaf> = {}): LayoutLeaf => ({ type: 'leaf', blockId, ...extra })

describe('dropNode — insert an existing node (snap / rearrange primitive)', () => {
  it('drops a whole node onto an edge, wrapping the target in a split', () => {
    const next = dropNode(leaf('a'), [], leaf('b'), 'right') as LayoutSplit
    expect(next.type).toBe('split')
    expect(next.direction).toBe('horizontal')
    expect(next.children.map(c => (c as LayoutLeaf).blockId)).toEqual(['a', 'b'])
  })
  it('can drop a SUBTREE (not just a leaf), unlike dropBlock', () => {
    const sub: LayoutSplit = { type: 'split', direction: 'vertical', children: [leaf('x'), leaf('y')] }
    const next = dropNode(leaf('a'), [], sub, 'left') as LayoutSplit
    expect(next.children[0]).toMatchObject({ type: 'split', direction: 'vertical' })
    expect(next.children[1]).toMatchObject({ type: 'leaf', blockId: 'a' })
  })
  it('center drop swaps the whole target node', () => {
    expect(dropNode(leaf('a'), [], leaf('b'), 'center')).toMatchObject({ type: 'leaf', blockId: 'b' })
  })
  it('seeds an empty tree with the dropped node', () => {
    expect(dropNode(null, [], leaf('a'), 'right')).toMatchObject({ type: 'leaf', blockId: 'a' })
  })
  it('the dropped node sheds its outer size so the pair shares the pane', () => {
    const next = dropNode(leaf('a'), [], leaf('b', { defaultSize: 80 }), 'right') as LayoutSplit
    expect((next.children[1] as LayoutLeaf).defaultSize).toBeUndefined()
  })
})

describe('detachNode — pop a node out to a free card', () => {
  it('returns the removed node and the remaining tree', () => {
    const { root, detached } = detachNode(masterDetail(), [0])
    expect(detached).toMatchObject({ type: 'leaf', blockId: 'list' })
    // the surviving sibling collapses up into the root
    expect(root).toMatchObject({ type: 'leaf', blockId: 'form' })
  })
  it('detaching the whole root empties the tree', () => {
    const { root, detached } = detachNode(leaf('only'), [])
    expect(detached).toMatchObject({ type: 'leaf', blockId: 'only' })
    expect(root).toBeNull()
  })
  it('a non-existent path detaches nothing', () => {
    const { root, detached } = detachNode(masterDetail(), [9])
    expect(detached).toBeNull()
    expect(root).toMatchObject({ type: 'split' })
  })
})

describe('findNodePath — locate a node by reference', () => {
  it('finds a child by identity', () => {
    const root = masterDetail()
    const form = root.children[1]!
    expect(findNodePath(root, form)).toEqual([1])
  })
  it('returns null when the node is not in the tree', () => {
    expect(findNodePath(masterDetail(), leaf('ghost'))).toBeNull()
  })
})

describe('moveNode — rearrange a pane within the tree', () => {
  it('reorders two panes (move list to the right of form)', () => {
    // [list, form] → move list (path [0]) to form's right edge
    const root = masterDetail()
    const next = moveNode(root, [0], [1], 'right') as LayoutSplit
    expect(next.type).toBe('split')
    expect(next.children.map(c => (c as LayoutLeaf).blockId)).toEqual(['form', 'list'])
  })
  it('is a no-op when moving a node into its own subtree', () => {
    const root: LayoutSplit = {
      type: 'split', direction: 'horizontal',
      children: [{ type: 'split', direction: 'vertical', children: [leaf('a'), leaf('b')] }, leaf('c')],
    }
    // moving [0] (the inner split) into [0,1] (its own descendant) → refused
    expect(moveNode(root, [0], [0, 1], 'right')).toBe(root)
  })
  it('is a no-op when source and target are the same path', () => {
    const root = masterDetail()
    expect(moveNode(root, [0], [0], 'right')).toBe(root)
  })
})

describe('nestInside — dwell-to-drop creates a nested app (WS2 nesting)', () => {
  it('wraps a target leaf + dropped node into a nested sub-layout', () => {
    const root = leaf('host')
    const next = nestInside(root, [], leaf('guest'), 'App') as LayoutNode
    expect(next.type).toBe('nested')
    const inner = getNestedLayout(next, [])!
    expect(inner.root).toMatchObject({ type: 'split', direction: 'horizontal' })
    expect((inner.root as LayoutSplit).children.map(c => (c as LayoutLeaf).blockId)).toEqual(['host', 'guest'])
  })
  it('drops INTO an existing nested app (appends to its sub-layout)', () => {
    const nested = makeNested({ renderer: 'panes', root: leaf('inner') }, 'App')
    const root: LayoutSplit = { type: 'split', direction: 'horizontal', children: [nested, leaf('side')] }
    const next = nestInside(root, [0], leaf('added')) as LayoutSplit
    const innerLayout = getNestedLayout(next.children[0]!, [])!
    expect((innerLayout.root as LayoutSplit).children.map(c => (c as LayoutLeaf).blockId)).toEqual(['inner', 'added'])
  })
  it('preserves the target slot size so the layout does not jump', () => {
    const root: LayoutSplit = {
      type: 'split', direction: 'horizontal',
      children: [leaf('host', { defaultSize: 70 }), leaf('side', { defaultSize: 30 })],
    }
    const next = nestInside(root, [0], leaf('guest')) as LayoutSplit
    expect((next.children[0] as LayoutNode).defaultSize).toBe(70)
  })
})
