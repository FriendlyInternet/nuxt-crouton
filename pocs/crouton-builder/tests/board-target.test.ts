import { describe, it, expect } from 'vitest'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { expandGroups, collapseGroups } from '../app/utils/board-groups'
import {
  resolveTarget, dropOnPage, placeBlock, movePaneToTarget,
  type BoardGeometry, type BoardTarget, type Rect,
} from '../app/utils/board-target'

// #3916 — drop on the page's edge, under a short block, or beside a group.

const R = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom })

/** The owner's page: stats left; form above list on the right. */
function geo(extra: Partial<BoardGeometry> = {}): BoardGeometry {
  return {
    frame: R(0, 0, 400, 800),
    root: R(0, 0, 400, 500),
    groups: [],
    panes: [
      { path: [0], rect: R(0, 0, 100, 200) },
      { path: [1, 0], rect: R(106, 0, 400, 300) },
      { path: [1, 1], rect: R(106, 301, 400, 500) },
    ],
    handles: [],
    ...extra,
  }
}
const group1 = { path: [1], rect: R(106, 0, 400, 500) }
const pick = (t: BoardTarget | null) => (t ? { scope: t.scope, path: t.path, edge: t.edge } : null)

describe('resolveTarget — one target per point, by a fixed order (#3916)', () => {
  it('1 · below the tree → page bottom', () => {
    expect(pick(resolveTarget(200, 650, geo()))).toEqual({ scope: 'page', path: [], edge: 'bottom' })
  })

  it('2 · inside the tree, 5 px from its bottom → page bottom (not the list\'s edge)', () => {
    expect(pick(resolveTarget(200, 495, geo()))).toEqual({ scope: 'page', path: [], edge: 'bottom' })
  })

  it('3 · the page\'s left, top and right bands', () => {
    expect(pick(resolveTarget(5, 100, geo()))).toEqual({ scope: 'page', path: [], edge: 'left' })
    expect(pick(resolveTarget(200, 8, geo()))).toEqual({ scope: 'page', path: [], edge: 'top' })
    expect(pick(resolveTarget(395, 100, geo()))).toEqual({ scope: 'page', path: [], edge: 'right' })
  })

  it('4 · a block\'s middle and edge, as today', () => {
    expect(pick(resolveTarget(50, 100, geo()))).toEqual({ scope: 'pane', path: [0], edge: 'center' })
    expect(pick(resolveTarget(50, 30, geo()))).toEqual({ scope: 'pane', path: [0], edge: 'top' })
  })

  it('5 · the empty space under stats → stats bottom', () => {
    expect(pick(resolveTarget(50, 350, geo()))).toEqual({ scope: 'pane', path: [0], edge: 'bottom' })
  })

  it('6 · on the divider, nothing above → null', () => {
    expect(resolveTarget(103, 100, geo())).toBeNull()
  })

  it('7 · a group\'s outer edge → beside the group; its inside → the block', () => {
    const g = geo({ groups: [group1] })
    expect(pick(resolveTarget(120, 250, g))).toEqual({ scope: 'group', path: [1], edge: 'left' })
    expect(pick(resolveTarget(250, 150, g))).toEqual({ scope: 'pane', path: [1, 0], edge: 'center' })
  })

  it('8 · the page band wins over the group band', () => {
    expect(pick(resolveTarget(398, 250, geo({ groups: [group1] })))).toEqual({ scope: 'page', path: [], edge: 'right' })
  })

  it('8b · a resize handle is not a drop spot', () => {
    expect(resolveTarget(103, 250, geo({ handles: [R(100, 0, 106, 500)] }))).toBeNull()
    const stacked: BoardGeometry = {
      frame: R(0, 0, 400, 800),
      root: R(0, 0, 400, 500),
      groups: [],
      panes: [
        { path: [0], rect: R(0, 0, 400, 100) },
        { path: [1, 0], rect: R(0, 101, 100, 300) },
        { path: [1, 1], rect: R(106, 101, 400, 500) },
      ],
      handles: [R(100, 101, 106, 500)],
    }
    expect(resolveTarget(103, 350, stacked)).toBeNull()
  })

  it('8c · a scrolled tree: the bands are the tree\'s own, the bar is clipped to the frame', () => {
    const g = geo({ frame: R(0, 100, 400, 800), root: R(0, -200, 400, 500) })
    expect(pick(resolveTarget(200, 110, g))).toEqual({ scope: 'pane', path: [1, 0], edge: 'center' })
    const t = resolveTarget(200, 495, g)
    expect(pick(t)).toEqual({ scope: 'page', path: [], edge: 'bottom' })
    expect(t!.rect).toEqual(R(0, 100, 400, 500))
  })

  it('9 · guard: never onto the dragged block or beneath it; never the whole page', () => {
    expect(resolveTarget(250, 150, geo({ groups: [group1] }), [1])).toBeNull()
    expect(resolveTarget(50, 100, geo(), [0])).toBeNull()
    expect(resolveTarget(200, 650, geo(), [])).toBeNull()
    expect(pick(resolveTarget(120, 250, geo({ groups: [group1] }), [1, 0]))).toEqual({ scope: 'group', path: [1], edge: 'left' })
  })
})

// ── Tree results, through the real package functions ─────────────────────────
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

const owner = () => row([leaf('stats', 20), column([leaf('form'), leaf('list')], { defaultSize: 80 })])
const NEW = () => leaf('new')
const page = (edge: BoardTarget['edge']): BoardTarget => ({ scope: 'page', path: [], edge, rect: R(0, 0, 0, 0) })
const grp = (path: number[], edge: BoardTarget['edge']): BoardTarget => ({ scope: 'group', path, edge, rect: R(0, 0, 0, 0) })
const pane = (path: number[], edge: BoardTarget['edge']): BoardTarget => ({ scope: 'pane', path, edge, rect: R(0, 0, 0, 0) })
const saved = (n: LayoutNode) => collapseGroups(n)

/** The children's sizes, each close to 33.3. */
function expectThirds(n: LayoutNode) {
  if (n.type !== 'split') throw new Error('not a split')
  expect(n.children).toHaveLength(3)
  for (const c of n.children) expect(c.defaultSize).toBeCloseTo(33.3, 1)
}
const strip = (n: LayoutNode): LayoutNode => {
  const c = { ...n } as LayoutNode
  delete c.defaultSize
  return c
}

describe('dropOnPage — a full line or column (#3916)', () => {
  it('10 · bottom → a full-width line under everything', () => {
    expect(saved(dropOnPage(owner(), 'bottom', NEW()))).toEqual(column([owner(), NEW()]))
  })

  it('11 · top → a full-width line above everything', () => {
    expect(saved(dropOnPage(owner(), 'top', NEW()))).toEqual(column([NEW(), owner()]))
  })

  it('12 · right on a row → joins the page\'s row as last, widths even', () => {
    const out = saved(dropOnPage(owner(), 'right', NEW()))
    expectThirds(out)
    expect((out as any).children.map(strip)).toEqual([leaf('stats'), column([leaf('form'), leaf('list')]), NEW()])
  })

  it('13 · a column page: bottom joins, left wraps', () => {
    const out = saved(dropOnPage(column([leaf('a'), leaf('b')]), 'bottom', NEW()))
    expect(out).toMatchObject({ type: 'split', direction: 'vertical' })
    expectThirds(out)
    expect((out as any).children.map(strip)).toEqual([leaf('a'), leaf('b'), NEW()])
    expect(saved(dropOnPage(column([leaf('a'), leaf('b')]), 'left', NEW()))).toEqual(row([NEW(), column([leaf('a'), leaf('b')])]))
  })

  it('14 · a single block as the page', () => {
    expect(saved(dropOnPage(leaf('a'), 'bottom', NEW()))).toEqual(column([leaf('a'), NEW()]))
  })

  it('15 · a group as the whole page → beside the group, not into it', () => {
    const out = saved(dropOnPage(expandGroups(G([leaf('a'), leaf('b')])), 'right', NEW()))
    expect(out).toEqual(row([G([leaf('a'), leaf('b')]), NEW()]))
  })
})

describe('movePaneToTarget / placeBlock (#3916)', () => {
  it('16 · move to the page\'s bottom; no-ops return the same root', () => {
    expect(saved(movePaneToTarget(owner(), [1, 1], page('bottom'))))
      .toEqual(column([row([leaf('stats', 20), leaf('form', 80)]), leaf('list')]))

    const o = owner()
    expect(movePaneToTarget(o, [], page('bottom'))).toBe(o)
    const ab = column([leaf('a'), leaf('b')])
    expect(movePaneToTarget(ab, [1], page('bottom'))).toBe(ab)
    const abc = column([leaf('a'), leaf('b'), leaf('c')])
    expect(movePaneToTarget(abc, [0], page('top'))).toBe(abc)
    const rab = row([leaf('a'), leaf('b')])
    expect(movePaneToTarget(rab, [1], page('right'))).toBe(rab)

    const moved = saved(movePaneToTarget(abc, [0], page('bottom')))
    expect(moved).toMatchObject({ type: 'split', direction: 'vertical' })
    expectThirds(moved)
    expect((moved as any).children.map(strip)).toEqual([leaf('b'), leaf('c'), leaf('a')])
  })

  const work = () => expandGroups(row([leaf('stats', 30), G([leaf('list'), leaf('form')], { defaultSize: 70 })]))

  it('17 · a new block on a group\'s edge lands beside the group', () => {
    expect(saved(placeBlock(work(), grp([1], 'bottom'), NEW())))
      .toEqual(row([leaf('stats', 30), column([G([leaf('list'), leaf('form')]), NEW()], { defaultSize: 70 })]))
    const out = saved(placeBlock(work(), grp([1], 'right'), NEW()))
    expectThirds(out)
    expect((out as any).children.map(strip)).toEqual([leaf('stats'), G([leaf('list'), leaf('form')]), NEW()])
  })

  it('18 · a block moved onto a group\'s edge', () => {
    expect(saved(movePaneToTarget(work(), [0], grp([1], 'bottom'))))
      .toEqual(column([G([leaf('list'), leaf('form')]), leaf('stats')]))
  })

  it('19 · a block onto its own two-block group\'s edge: still a group, stacked', () => {
    expect(saved(movePaneToTarget(work(), [1, 0], grp([1], 'bottom'))))
      .toEqual(row([leaf('stats', 30), nested(column([leaf('form'), leaf('list')]), { defaultSize: 70 })]))
  })

  it('20 · a block onto its own three-block group\'s edge leaves the group; under a short block', () => {
    const three = expandGroups(row([leaf('stats', 30), G([leaf('list'), leaf('form'), leaf('x')], { defaultSize: 70 })]))
    const out = saved(movePaneToTarget(three, [1, 0], grp([1], 'bottom')))
    expect(out).toMatchObject({ type: 'split', direction: 'horizontal' })
    const right = (out as any).children[1]
    expect((out as any).children[0]).toEqual(leaf('stats', 30))
    expect(right).toMatchObject({ type: 'split', direction: 'vertical', defaultSize: 70 })
    expect(right.children.map(strip)).toEqual([G([leaf('form'), leaf('x')]), leaf('list')])

    expect(saved(placeBlock(owner(), pane([0], 'bottom'), NEW())))
      .toEqual(row([column([leaf('stats'), NEW()], { defaultSize: 20 }), column([leaf('form'), leaf('list')], { defaultSize: 80 })]))
  })

  it('a middle drop is never placed by placeBlock (the page swaps it)', () => {
    const o = owner()
    expect(placeBlock(o, pane([0], 'center'), NEW())).toBe(o)
  })
})
