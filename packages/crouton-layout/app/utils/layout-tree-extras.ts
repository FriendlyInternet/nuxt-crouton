import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'

/**
 * The tree `CroutonLayout` emits after an edit (#3650): the edited root plus the
 * tree's `sources` map, so editing a layout never drops its store options.
 * `sources` is omitted when empty. Pure.
 */
export function withTreeExtras(root: LayoutNode, sources: LayoutTree['sources']): LayoutTree {
  return {
    renderer: 'panes',
    root,
    ...(sources && Object.keys(sources).length ? { sources } : {}),
  }
}
