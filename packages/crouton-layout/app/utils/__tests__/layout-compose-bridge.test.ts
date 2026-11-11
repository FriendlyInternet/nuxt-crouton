import { describe, it, expect } from 'vitest'
import { treeToPieces, piecesToTree, piecePath } from '../layout-compose-bridge'
import { makeNested } from '../layout-edit'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'

const hsplit: LayoutTree = {
  renderer: 'panes',
  root: { type: 'split', direction: 'horizontal', children: [
    { type: 'leaf', blockId: 'demo-a' },
    { type: 'leaf', blockId: 'demo-b' },
  ] },
}

describe('treeToPieces — explode a layout into draggable cards', () => {
  it('decomposes a split root into one free piece per top-level child', () => {
    const pieces = treeToPieces(hsplit)
    expect(pieces).toHaveLength(2)
    expect(pieces.map(p => p.node)).toEqual(hsplit.root.type === 'split' ? hsplit.root.children : [])
    // tiled horizontally for a horizontal split (distinct, increasing x; shared y)
    expect(pieces[0]!.x).toBeLessThan(pieces[1]!.x)
    expect(pieces[0]!.y).toBe(pieces[1]!.y)
  })

  it('tiles a vertical split down the y-axis', () => {
    const vtree: LayoutTree = { renderer: 'panes', root: { type: 'split', direction: 'vertical', children: [
      { type: 'leaf', blockId: 'a' }, { type: 'leaf', blockId: 'b' },
    ] } }
    const pieces = treeToPieces(vtree)
    expect(pieces[0]!.y).toBeLessThan(pieces[1]!.y)
    expect(pieces[0]!.x).toBe(pieces[1]!.x)
  })

  it('treats a leaf or nested root as a single piece (and labels a nested app)', () => {
    expect(treeToPieces({ renderer: 'panes', root: { type: 'leaf', blockId: 'solo' } })).toHaveLength(1)
    const nested = treeToPieces({ renderer: 'panes', root: makeNested(hsplit, 'Calendar') })
    expect(nested).toHaveLength(1)
    expect(nested[0]!.label).toBe('Calendar')
  })

  it('honours a custom labelOf resolver', () => {
    const pieces = treeToPieces(hsplit, { labelOf: n => (n.type === 'leaf' ? n.blockId.toUpperCase() : undefined) })
    expect(pieces[0]!.label).toBe('DEMO-A')
  })

  it('column:true forces a vertical stack even for a horizontal split (mobile)', () => {
    const pieces = treeToPieces(hsplit, { column: true, width: 320 })
    expect(pieces[0]!.x).toBe(pieces[1]!.x) // same column
    expect(pieces[0]!.y).toBeLessThan(pieces[1]!.y) // stacked down
    expect(pieces[0]!.width).toBe(320)
  })
})

describe('piecesToTree — recompose the authoritative tree', () => {
  it('one piece → its node is the whole root', () => {
    const piece = { id: 'p', node: { type: 'leaf' as const, blockId: 'solo' }, x: 0, y: 0, width: 200, height: 140 }
    expect(piecesToTree([piece]).root).toEqual({ type: 'leaf', blockId: 'solo' })
  })

  it('many pieces → a split, axis inferred from their on-canvas spread', () => {
    const pieces = [
      { id: 'a', node: { type: 'leaf' as const, blockId: 'a' }, x: 0, y: 0, width: 200, height: 140 },
      { id: 'b', node: { type: 'leaf' as const, blockId: 'b' }, x: 400, y: 0, width: 200, height: 140 },
    ]
    const root = piecesToTree(pieces).root
    expect(root.type).toBe('split')
    if (root.type === 'split') {
      expect(root.direction).toBe('horizontal')
      expect(root.children.map(c => (c.type === 'leaf' ? c.blockId : '?'))).toEqual(['a', 'b'])
    }
  })

  it('orders children along the inferred axis (right-to-left placement still binds left-to-right)', () => {
    const pieces = [
      { id: 'a', node: { type: 'leaf' as const, blockId: 'a' }, x: 500, y: 0, width: 200, height: 140 },
      { id: 'b', node: { type: 'leaf' as const, blockId: 'b' }, x: 0, y: 0, width: 200, height: 140 },
    ]
    const root = piecesToTree(pieces).root
    if (root.type === 'split') expect(root.children.map(c => (c.type === 'leaf' ? c.blockId : '?'))).toEqual(['b', 'a'])
  })

  it('infers a vertical split when pieces are stacked', () => {
    const pieces = [
      { id: 'a', node: { type: 'leaf' as const, blockId: 'a' }, x: 0, y: 0, width: 200, height: 140 },
      { id: 'b', node: { type: 'leaf' as const, blockId: 'b' }, x: 0, y: 400, width: 200, height: 140 },
    ]
    const root = piecesToTree(pieces).root
    if (root.type === 'split') expect(root.direction).toBe('vertical')
  })

  it('carries the base renderer + breakpoints (compose restructures root only)', () => {
    const base: LayoutTree = { renderer: 'panes', root: hsplit.root, breakpoints: [{ minWidth: 0, label: 'Phone' }] }
    const out = piecesToTree([{ id: 'p', node: { type: 'leaf', blockId: 'x' }, x: 0, y: 0, width: 1, height: 1 }], base)
    expect(out.breakpoints).toEqual(base.breakpoints)
  })

  it('carries auto: true for both the 1-piece and the many-piece branch (#3816)', () => {
    const base: LayoutTree = { ...hsplit, auto: true }
    const one = piecesToTree([{ id: 'p', node: { type: 'leaf', blockId: 'x' }, x: 0, y: 0, width: 1, height: 1 }], base)
    expect(one.auto).toBe(true)
    const many = piecesToTree([
      { id: 'a', node: { type: 'leaf', blockId: 'a' }, x: 0, y: 0, width: 100, height: 50 },
      { id: 'b', node: { type: 'leaf', blockId: 'b' }, x: 200, y: 0, width: 100, height: 50 },
    ], base)
    expect(many.auto).toBe(true)
    expect(piecesToTree(treeToPieces(hsplit), hsplit).auto).toBeUndefined()
  })
})

describe('piecePath — map a clicked card to its zoom target path', () => {
  const a = { id: 'a', node: makeNested(hsplit, 'A'), x: 0, y: 0, width: 200, height: 140 }
  const b = { id: 'b', node: { type: 'leaf' as const, blockId: 'b' }, x: 400, y: 0, width: 200, height: 140 }

  it('a single piece IS the root (path [])', () => {
    expect(piecePath([a], 'a')).toEqual([])
  })

  it('among many, the path is the position-sorted slot — and matches piecesToTree', () => {
    const path = piecePath([b, a], 'a') // a sits left of b → slot 0
    expect(path).toEqual([0])
    // cross-check: that path in the recomposed tree addresses a's node
    const root = piecesToTree([b, a]).root
    expect(root.type === 'split' && root.children[0]).toMatchObject({ type: 'nested', label: 'A' })
  })

  it('returns null for an unknown piece', () => {
    expect(piecePath([a, b], 'ghost')).toBeNull()
  })
})

describe('round-trip — pieces ↔ tree preserves the arrangement', () => {
  it('treeToPieces → piecesToTree renders the same blocks in order', () => {
    const out = piecesToTree(treeToPieces(hsplit), hsplit).root
    expect(out.type).toBe('split')
    if (out.type === 'split') {
      expect(out.direction).toBe('horizontal')
      expect(out.children.map(c => (c.type === 'leaf' ? c.blockId : '?'))).toEqual(['demo-a', 'demo-b'])
    }
  })

  it('a snap (two cards → one grouped piece) recomposes to that group as the root', () => {
    // After the canvas snaps demo-a + demo-b, pieces collapses to a single grouped piece.
    const grouped = { id: 'g', node: hsplit.root, x: 0, y: 0, width: 480, height: 160 }
    expect(piecesToTree([grouped], hsplit).root).toEqual(hsplit.root)
  })
})
