/**
 * Pure LayoutSplit → Nuxt UI `SplitterItem[]` mapping for the editable panes
 * (`CroutonLayoutComposePane`, `CroutonLayoutEditorPane`) — #3707.
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
