/**
 * The empty board (#3808). A page starts with no blocks and stays empty when its
 * last block is removed. The package's `LayoutTree` can't be empty (`root` is
 * required), so in this POC an empty board is a variant whose `tree` is `null`,
 * saved as `layout: ''` (which `/site/[slug]` already reads as an empty page).
 */
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { serializeLayoutTree, parseLayoutTree } from '@fyit/crouton-layout/app/utils/layout-serialize'
import { patchBreakpoint } from '@fyit/crouton-layout/app/utils/layout-responsive'

export interface BoardVariant { id: string, name: string, tree: LayoutTree | null }

/**
 * Apply an edit's new root to the variant's tree.
 * - empty board: the first block becomes the base layout (whatever the width);
 * - base layout (`writeTarget` null): no root left ⇒ the board is empty;
 * - at a width: no root left ⇒ that width stops overriding the arrangement and
 *   shows the base layout again (the breakpoint goes if `root` was all it held).
 */
export function editRoot(tree: LayoutTree | null, next: LayoutNode | null, writeTarget: number | null): LayoutTree | null {
  if (!tree) return next ? { renderer: 'panes', root: next } : null
  if (writeTarget === null) return next ? { ...tree, root: next } : null
  if (next) return patchBreakpoint(tree, writeTarget, { root: next })
  const list = (tree.breakpoints ?? []).flatMap((b) => {
    if (b.minWidth !== writeTarget) return [b]
    const { root: _drop, ...rest } = b
    return Object.keys(rest).length > 1 ? [rest] : []
  })
  if (list.length) return { ...tree, breakpoints: list }
  const { breakpoints: _omit, ...base } = tree
  return base
}

/** A stored variant layout → its tree: nothing stored ⇒ empty; unparseable ⇒ the starter. */
export function variantTreeFrom(layout: unknown, starter: () => LayoutTree): LayoutTree | null {
  if (layout === '' || layout === null || layout === undefined) return null
  return (typeof layout === 'string' ? parseLayoutTree(layout) : null) ?? starter()
}

/** A variant's tree → its stored layout (`''` for an empty board). */
export function variantLayout(tree: LayoutTree | null): string {
  return tree ? serializeLayoutTree(tree) : ''
}

/**
 * The page's `board` JSON → its variants. Reads the `variants[]` shape and the older
 * `{ layout }` shape. A page with nothing stored starts empty and is already saved
 * (the board and the served page agree); only a legacy layout that fails to parse
 * falls back to the starter, which is unsaved so Save stores it (#2598).
 */
export function loadBoard(board: Record<string, unknown> | null, starter: () => LayoutTree): { variants: BoardVariant[], liveId: string, unsaved: boolean } {
  const b = board ?? {}
  const stored = Array.isArray(b.variants) ? b.variants as { id: string, name: string, layout?: unknown }[] : null
  if (stored?.length) {
    const variants = stored.map(v => ({ id: v.id, name: v.name, tree: variantTreeFrom(v.layout, starter) }))
    const liveId = typeof b.live === 'string' && variants.some(v => v.id === b.live) ? b.live : variants[0]!.id
    return { variants, liveId, unsaved: false }
  }
  const tree = variantTreeFrom(b.layout, starter)
  const parsedOrEmpty = b.layout === '' || b.layout === null || b.layout === undefined
    || (typeof b.layout === 'string' && parseLayoutTree(b.layout) !== null)
  return { variants: [{ id: 'a', name: 'A', tree }], liveId: 'a', unsaved: !parsedOrEmpty }
}
