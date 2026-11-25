/**
 * Pure LayoutSplit → Nuxt UI `SplitterItem[]` mapping for the editable panes
 * (`CroutonLayoutComposePane`, `CroutonLayoutEditorPane`) — #3707 — and the
 * renderer's splitter path (`CroutonLayoutRenderer`) — #3708.
 *
 * USplitter wraps reka-ui's Splitter: it renders one `SplitterPanel` per item
 * (keyed `item.id ?? index`) with a handle between each. Items deliberately
 * carry NO `id`, so panel keys stay index-based — `editor.resize(path, sizes)`
 * relies on sizes arriving in child order.
 *
 * Every item uses the shared slot `'pane'`, so a template needs a single
 * `<template #pane="{ index }">`. `ui.panel: 'block'` cancels the theme's
 * `panel: "flex"` (same override as crouton-sales' EventWorkspace shell), and
 * `class: 'overflow-hidden'` keeps the pre-USplitter panel class.
 */
import type { SplitterItem } from '@nuxt/ui'
import type { LayoutNode, LayoutSplit } from '@fyit/crouton-core/app/types/layout'

/** Compose pane: default sizes only — NO minSize, NO id (keys stay index-based). */
export function composeSplitterItems(split: LayoutSplit): SplitterItem[] {
  const n = split.children.length
  return split.children.map(c => ({
    class: 'overflow-hidden',
    ui: { panel: 'block' },
    slot: 'pane',
    defaultSize: c.defaultSize ?? 100 / n,
  }))
}

/** Editor pane: same as compose, plus `minSize` from the caller's px→% floor. */
export function editorSplitterItems(
  split: LayoutSplit,
  minFor: (child: LayoutNode) => number,
): SplitterItem[] {
  return composeSplitterItems(split).map((item, i) => ({ ...item, minSize: minFor(split.children[i]!) }))
}

/**
 * Handle classes per orientation. Plain `w-`/`h-` utilities (not
 * `data-[orientation=…]:` variants) so tailwind-merge replaces the theme's
 * `w-2`/`h-2` thickness. Literal class strings so Tailwind's scanner sees them.
 */
const HANDLE_CLASS = {
  horizontal: { px: 'w-px', 1: 'w-1' },
  vertical: { px: 'h-px', 1: 'h-1' },
} as const

export function splitterHandleClass(direction: 'horizontal' | 'vertical', thickness: 'px' | '1'): string {
  return HANDLE_CLASS[direction][thickness]
}

/** In-place collapse context for {@link rendererSplitterItems}. */
export interface RendererCollapse {
  /** Per child: is its whole subtree collapsed at the current breakpoint? */
  collapsed: boolean[]
  /** The thin resting size (%) a collapsed panel shrinks to. */
  pct: number
  /** The active in-place collapse style → the `mq-co-<style>` transition class. */
  style: string
}

/**
 * Renderer split: the editor items, plus — when an in-place collapse style is
 * active — every panel `collapsible` at `collapsedSize: pct` with the style's
 * `mq-co-*` flex-grow transition class, and each collapsed child pinned to `pct`.
 * `collapse: null` (no in-place style) leaves the collapse keys off entirely.
 */
export function rendererSplitterItems(
  split: LayoutSplit,
  minFor: (child: LayoutNode) => number,
  collapse: RendererCollapse | null,
): SplitterItem[] {
  const items = editorSplitterItems(split, minFor)
  if (!collapse) return items
  return items.map((item, i) => {
    const next: SplitterItem = {
      ...item,
      collapsible: true,
      collapsedSize: collapse.pct,
      class: `overflow-hidden mq-co-${collapse.style}`,
    }
    if (collapse.collapsed[i]) {
      next.defaultSize = collapse.pct
      next.minSize = collapse.pct
    }
    return next
  })
}

/**
 * Renderer handle: today's 1px `bg-border` divider when interactive; `hidden`
 * (paired with USplitter's `disabled`) when not — a view-only in-place-collapse
 * split shows no draggable seam.
 */
export function rendererHandleClass(direction: 'horizontal' | 'vertical', interactive: boolean): string {
  if (!interactive) return 'hidden'
  return `bg-border hover:bg-primary transition-colors ${splitterHandleClass(direction, 'px')}`
}

/**
 * What to do with a panel given the WANTED collapsed state vs its live state.
 * `want === undefined` means "no collapse context" → never touch the panel.
 */
export function collapseAction(want: boolean | undefined, isCollapsed: boolean): 'collapse' | 'expand' | null {
  if (want === true && !isCollapsed) return 'collapse'
  if (want === false && isCollapsed) return 'expand'
  return null
}
