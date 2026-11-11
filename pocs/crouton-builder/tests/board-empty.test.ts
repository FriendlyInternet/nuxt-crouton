/**
 * #3808 — a new page starts empty and stays empty when its last block is removed.
 * Runs the real helpers the board uses (`editRoot` in writeRoot, `loadBoard` in
 * useBoardVariants' load) with the package's real `removeNode` / serializer.
 */
import { describe, it, expect, vi } from 'vitest'
import type { LayoutLeaf, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { removeNode } from '@fyit/crouton-layout/app/utils/layout-edit'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { editRoot, loadBoard, variantLayout, variantTreeFrom } from '../app/utils/board-empty'

const leaf: LayoutLeaf = { type: 'leaf', blockId: 'artists-list' }
const other: LayoutLeaf = { type: 'leaf', blockId: 'artists-form' }
const starterTree = (): LayoutTree => ({
  renderer: 'panes',
  root: { type: 'split', direction: 'horizontal', children: [leaf, other] },
})

describe('empty board (#3808)', () => {
  it('removing the only block leaves an empty board, not the starter', () => {
    const oneLeafTree: LayoutTree = { renderer: 'panes', root: leaf }
    expect(editRoot(oneLeafTree, removeNode(leaf, []), null)).toBeNull()
  })

  it('a new page with nothing stored starts empty', () => {
    for (const board of [{}, null]) {
      const starter = vi.fn(starterTree)
      const loaded = loadBoard(board, starter)
      expect(loaded.variants).toHaveLength(1)
      expect(loaded.variants[0]).toMatchObject({ id: 'a', name: 'A', tree: null })
      expect(loaded.unsaved).toBe(false)
      expect(starter).not.toHaveBeenCalled()
    }
  })

  it('an empty board survives save → reload', () => {
    const loaded = loadBoard({ live: 'a', variants: [{ id: 'a', name: 'A', layout: variantLayout(null) }], layout: variantLayout(null) }, starterTree)
    expect(loaded.variants[0]!.tree).toBeNull()
  })

  it('a saved page loads unchanged', () => {
    const T = starterTree()
    const loaded = loadBoard({ live: 'a', variants: [{ id: 'a', name: 'A', layout: serializeLayoutTree(T) }] }, starterTree)
    expect(loaded.variants[0]!.tree).toEqual(parseLayoutTree(serializeLayoutTree(T)))
  })

  it('a stored layout that fails to parse still falls back to the starter (unchanged)', () => {
    expect(variantTreeFrom('{not json', starterTree)).toEqual(starterTree())
  })

  it('the first block on an empty board becomes the base layout', () => {
    const t = editRoot(null, leaf, 768)
    expect(t).toEqual({ renderer: 'panes', root: leaf })
    expect(t?.breakpoints).toBeUndefined()
  })

  it('emptying an override at a width shows the base layout again', () => {
    const tree: LayoutTree = { renderer: 'panes', root: leaf, breakpoints: [{ minWidth: 768, root: other }] }
    const next = editRoot(tree, null, 768)
    expect(next?.root).toEqual(leaf)
    expect(next?.breakpoints?.find(b => b.minWidth === 768)?.root).toBeUndefined()
  })

  it('a chosen width with no layout of its own: removing the only block leaves an empty board', () => {
    const oneLeafTree: LayoutTree = { renderer: 'panes', root: leaf }
    expect(editRoot(oneLeafTree, removeNode(leaf, []), 390)).toBeNull()
    // a width-only breakpoint that sets no root (e.g. collapsed blocks) doesn't hold the arrangement
    const collapsedOnly: LayoutTree = { renderer: 'panes', root: leaf, breakpoints: [{ minWidth: 768, collapsed: ['artists-list'] }] }
    expect(editRoot(collapsedOnly, null, 1024)).toBeNull()
  })

  it('a chosen width above an override: removing the last block drops that override', () => {
    const tree: LayoutTree = { renderer: 'panes', root: leaf, breakpoints: [{ minWidth: 768, root: other }] }
    const next = editRoot(tree, null, 1024)
    expect(next).not.toBeNull()
    expect(next).not.toEqual(tree)
    expect(next?.root).toEqual(leaf)
    expect(next?.breakpoints).toBeUndefined()
  })
})
