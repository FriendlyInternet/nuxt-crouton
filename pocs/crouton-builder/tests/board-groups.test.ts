import { describe, it, expect } from 'vitest'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import {
  applyPaneDrop, applySizes, removeNode, detachNode, nestInside,
} from '@fyit/crouton-layout/app/utils/layout-edit'
import {
  expandGroups, collapseGroups, movePane, ungroupAt, isGroup,
} from '../app/utils/board-groups'

// #3906 — groups on the board: a working tree with marked splits, saved as `nested`.
const leaf = (blockId: string, defaultSize?: number): LayoutNode =>
  ({ type: 'leaf', blockId, ...(defaultSize !== undefined ? { defaultSize } : {}) } as LayoutNode)
const row = (children: LayoutNode[], extra: Record<string, unknown> = {}): LayoutNode =>
  ({ type: 'split', direction: 'horizontal', children, ...extra } as LayoutNode)
const column = (children: LayoutNode[], extra: Record<string, unknown> = {}): LayoutNode =>
  ({ type: 'split', direction: 'vertical', children, ...extra } as LayoutNode)
/** A saved group: a `nested` node whose root is a horizontal split of the blocks. */
const G = (children: LayoutNode[], extra: Record<string, unknown> = {}): LayoutNode =>
  ({ type: 'nested', layout: { renderer: 'panes', root: row(children) }, ...extra } as LayoutNode)
const nested = (root: LayoutNode, extra: Record<string, unknown> = {}): LayoutNode =>
  ({ type: 'nested', layout: { renderer: 'panes', root }, ...extra } as LayoutNode)

const stats = () => leaf('stats', 30)
const saved = () => row([stats(), G([leaf('list'), leaf('form')], { defaultSize: 70 })])
const work = () => expandGroups(saved())

/** Case 3: the saved form never carries the working-tree marker. */
function savedForm(x: LayoutNode): LayoutNode {
  const out = collapseGroups(x)
  expect(JSON.stringify(out).includes('__boardGroup')).toBe(false)
  return out
}

describe('board groups: expand / collapse (#3906)', () => {
  it('1 · collapseGroups(expandGroups(saved)) equals saved', () => {
    expect(collapseGroups(expandGroups(saved()))).toEqual(saved())
    const deep = G([leaf('a'), G([leaf('b'), leaf('c')])])
    expect(collapseGroups(expandGroups(deep))).toEqual(deep)
    const bps = { type: 'nested', layout: { renderer: 'panes', root: row([leaf('a'), leaf('b')]), breakpoints: [{ minWidth: 800, root: row([leaf('b'), leaf('a')]) }] }, defaultSize: 40 } as unknown as LayoutNode
    expect(collapseGroups(expandGroups(row([leaf('x', 60), bps])))).toEqual(row([leaf('x', 60), bps]))
    const sized = G([leaf('a'), leaf('b')], { minSize: 20, label: 'Pair', defaultSize: 50 })
    expect(collapseGroups(expandGroups(row([leaf('x', 50), sized])))).toEqual(row([leaf('x', 50), sized]))
  })

  it('1b · a group whose only content is another group expands to ONE marked row', () => {
    const outer = nested(G([leaf('a'), leaf('b')], { label: 'Inner' }), { defaultSize: 55, label: 'Outer' })
    const x = expandGroups(outer)
    expect(isGroup(x)).toBe(true)
    expect(x).toMatchObject({ type: 'split', direction: 'horizontal', defaultSize: 55, children: [leaf('a'), leaf('b')] })
    expect((x as any).__boardGroup.label).toBe('Inner')
    expect(savedForm(x)).toEqual(G([leaf('a'), leaf('b')], { label: 'Inner', defaultSize: 55 }))
  })

  it('2 · a nested whose root is a single leaf expands to that leaf with the nested size', () => {
    expect(expandGroups(nested(leaf('a', 10), { defaultSize: 55 }))).toEqual(leaf('a', 55))
  })
})

describe('board groups: edits on the working tree (#3906)', () => {
  it('4 · join inside a group', () => {
    const r = applyPaneDrop(work(), { path: [1, 1], edge: 'right' }, leaf('new'))
    expect(savedForm(r)).toEqual(row([stats(), G([leaf('list', 33.3), leaf('form', 33.3), leaf('new', 33.3)], { defaultSize: 70 })]))
  })

  it('5 · split inside a group', () => {
    const r = applyPaneDrop(work(), { path: [1, 0], edge: 'bottom' }, leaf('new'))
    expect(savedForm(r)).toEqual(row([stats(), nested(row([column([leaf('list'), leaf('new')]), leaf('form')]), { defaultSize: 70 })]))
  })

  it('6 · swap inside a two-block group keeps the group', () => {
    const r = movePane(work(), [1, 0], [1, 1], 'right')
    expect(savedForm(r)).toEqual(row([stats(), G([leaf('form'), leaf('list')], { defaultSize: 70 })]))
  })

  it('7 · a centre drop inside a group counts as right', () => {
    const r = movePane(work(), [1, 0], [1, 1], 'center')
    expect(savedForm(r)).toEqual(row([stats(), G([leaf('form'), leaf('list')], { defaultSize: 70 })]))
  })

  it('8 · stack inside a two-block group', () => {
    const r = movePane(work(), [1, 0], [1, 1], 'bottom')
    expect(savedForm(r)).toEqual(row([stats(), nested(column([leaf('form'), leaf('list')]), { defaultSize: 70 })]))
  })

  it('9 · a group that is the whole page', () => {
    const r = movePane(expandGroups(G([leaf('a'), leaf('b')])), [0], [1], 'right')
    expect(savedForm(r)).toEqual(G([leaf('b'), leaf('a')]))
  })

  it('10 · a group\'s label and layout settings survive a swap', () => {
    const breakpoints = [{ minWidth: 900, root: row([leaf('list'), leaf('form')]) }]
    const g = { type: 'nested', label: 'Pair', defaultSize: 70, layout: { renderer: 'panes', breakpoints, root: row([leaf('list'), leaf('form')]) } } as unknown as LayoutNode
    const r = movePane(expandGroups(row([stats(), g])), [1, 0], [1, 1], 'right')
    expect(savedForm(r)).toEqual(row([stats(), { type: 'nested', label: 'Pair', defaultSize: 70, layout: { renderer: 'panes', breakpoints, root: row([leaf('form'), leaf('list')]) } } as unknown as LayoutNode]))
  })

  it('11 · drag out: a group left with one block stops being a group', () => {
    const r = movePane(work(), [1, 1], [0], 'left')
    const out = savedForm(r)
    expect(out).toEqual(row([leaf('form', 33.3), leaf('stats', 33.3), leaf('list', 33.3)]))
    expect(JSON.stringify(out).includes('nested')).toBe(false)
  })

  it('12 · drag in', () => {
    const r = movePane(work(), [0], [1, 0], 'right')
    expect(savedForm(r)).toEqual(G([leaf('list', 33.3), leaf('stats', 33.3), leaf('form', 33.3)]))
  })

  it('13 · move the whole group', () => {
    const r = movePane(work(), [1], [0], 'top')
    expect(savedForm(r)).toEqual(column([G([leaf('list'), leaf('form')]), leaf('stats')]))
  })

  it('14 · resize inside a group, and remove a sibling', () => {
    const r = applySizes(work(), [1], [40, 60])
    expect(savedForm(r)).toEqual(row([stats(), G([leaf('list', 40), leaf('form', 60)], { defaultSize: 70 })]))
    const removed = removeNode(work(), [0])!
    expect(savedForm(removed)).toEqual(G([leaf('list'), leaf('form')]))
  })

  it('15 · a middle drop on a plain block saves what it saves today', () => {
    const plain = row([leaf('a', 30), leaf('b', 30), leaf('c', 40)])
    const d = detachNode(plain, [2], [0])
    const today = nestInside(d.root, d.trackedPath!, d.detached!)
    const r = savedForm(movePane(plain, [2], [0], 'center'))
    expect(r).toEqual(today)
    expect(r).toEqual(row([G([leaf('a'), leaf('c')], { defaultSize: 50 }), leaf('b', 50)]))
  })

  it('16 · no group inside a group by a middle drop', () => {
    const r = movePane(work(), [0], [1, 0], 'center')
    expect(savedForm(r)).toEqual(G([leaf('list', 33.3), leaf('stats', 33.3), leaf('form', 33.3)]))
    const g = movePane(work(), [1], [0], 'center')
    expect(savedForm(g)).toEqual(row([leaf('stats'), G([leaf('list'), leaf('form')])]))
  })

  it('17 · ungroup leaves the same blocks in the same places', () => {
    expect(savedForm(ungroupAt(work(), [1]))).toEqual(row([stats(), row([leaf('list'), leaf('form')], { defaultSize: 70 })]))
    const plain = row([leaf('a'), leaf('b')])
    expect(ungroupAt(plain, [])).toBe(plain)
    const w = work()
    expect(ungroupAt(w, [0])).toBe(w)
  })

  it('18 · no-ops return the same root object', () => {
    const w = work()
    expect(movePane(w, [1, 0], [1, 0], 'right')).toBe(w)
    expect(movePane(w, [1], [1, 0], 'left')).toBe(w)
    expect(movePane(w, [5, 2], [0], 'left')).toBe(w)
    expect(movePane(w, [0], [9], 'center')).toBe(w)
  })
})
