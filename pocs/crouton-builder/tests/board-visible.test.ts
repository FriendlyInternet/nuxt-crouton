import { describe, it, expect } from 'vitest'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { applySizes } from '@fyit/crouton-layout/app/utils/layout-edit'
import {
  boardStackThreshold,
  toChildSizes,
  visibleDefaultSizes,
} from '../app/utils/board-visible'

// #3828 — the board's stack check and sizes read the visible panes only.
const registry = {
  'artists-stats': { minWidth: 200 },
  'artists-form': { minWidth: 320 },
  'entity-form': { minWidth: 320 },
} as any
const hidden = new Set(['entity-form'])

const leaf = (blockId: string, extra: Partial<LayoutNode> = {}): LayoutNode =>
  ({ type: 'leaf', id: blockId, blockId, ...extra } as any)
const split = (direction: 'horizontal' | 'vertical', children: LayoutNode[], extra: Partial<LayoutNode> = {}): LayoutNode =>
  ({ type: 'split', id: `s-${children.map(c => c.id).join('-')}`, direction, children, ...extra } as any)

const stats = () => leaf('artists-stats', { defaultSize: 30 })
const form = () => leaf('artists-form', { defaultSize: 40 })
const hiddenEF = () => leaf('entity-form', { defaultSize: 30 })

describe('board visible-only view (#3828)', () => {
  it('a horizontal split with one visible + one hidden child at 536 does not stack', () => {
    expect(boardStackThreshold(split('horizontal', [form(), hiddenEF()]), hidden, registry)).toBe(0)
    // Home's shape: row([vertical([stats/form row, hiddenEF]), hiddenEF])
    const home = split('horizontal', [
      split('vertical', [split('horizontal', [stats(), form()]), hiddenEF()]),
      hiddenEF(),
    ])
    expect(boardStackThreshold(home, hidden, registry)).toBe(0)
  })

  it('visible Stats 200 + Form 320 → threshold 520, not 840', () => {
    const row = split('horizontal', [stats(), form(), hiddenEF()])
    const t = boardStackThreshold(row, hidden, registry)
    expect(t).toBe(520)
    expect(536 > t).toBe(true) // side by side at 536
    // control: nothing hidden counts every pane
    expect(boardStackThreshold(row, new Set(), registry)).toBe(840)
  })

  it('visible defaultSizes re-normalise to 100', () => {
    const s = visibleDefaultSizes([leaf('a', { defaultSize: 30 }), leaf('b', { defaultSize: 40 })])
    expect(s[0]).toBeCloseTo(42.857, 2)
    expect(s[1]).toBeCloseTo(57.143, 2)
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6)
    // a missing size takes an equal share (100/2 = 50) before scaling
    const m = visibleDefaultSizes([leaf('a', { defaultSize: 50 }), leaf('b')])
    expect(m).toEqual([50, 50])
    // all-zero → equal shares
    expect(visibleDefaultSizes([leaf('a', { defaultSize: 0 }), leaf('b', { defaultSize: 0 })])).toEqual([50, 50])
  })

  it('a resize next to a hidden sibling writes to the right child indices', () => {
    const children = [leaf('a', { defaultSize: 30 }), leaf('entity-form', { defaultSize: 30 }), leaf('c', { defaultSize: 40 })]
    const out = toChildSizes(children, [0, 2], [60, 40])
    expect(out[0]).toBeCloseTo(42, 6)
    expect(out[1]).toBeUndefined()
    expect(out[2]).toBeCloseTo(28, 6)

    const root = split('horizontal', children)
    const next = applySizes(root, [], out as number[]) as any
    const sizes = next.children.map((c: LayoutNode) => c.defaultSize)
    expect(sizes[0]).toBeCloseTo(42, 6)
    expect(sizes[1]).toBe(30)
    expect(sizes[2]).toBeCloseTo(28, 6)
    expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(100, 6)

    // control: nothing hidden passes through unchanged
    const all = [leaf('a', { defaultSize: 30 }), leaf('b', { defaultSize: 30 }), leaf('c', { defaultSize: 40 })]
    expect(toChildSizes(all, [0, 1, 2], [20, 30, 50])).toEqual([20, 30, 50])

    // mount report: the rendered visible sizes map back to the stored ones
    const mount = toChildSizes(children, [0, 2], visibleDefaultSizes([children[0]!, children[2]!]))
    expect(mount[0]).toBeCloseTo(30, 6)
    expect(mount[1]).toBeUndefined()
    expect(mount[2]).toBeCloseTo(40, 6)
  })
})
