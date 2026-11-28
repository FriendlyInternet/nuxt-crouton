/**
 * Which layout store source a placed block reads from (#3651).
 *
 * The bookings Locations / Filters / list blocks take props only and are fed by
 * the `bookings` layout store, so a leaf of theirs needs `source: 'bookings'`.
 * The builder has no source picker yet (left for a later step of #2561), so it
 * seeds the source from this app-local map when a block is placed, and the
 * served page fills it in for pages saved before this existed.
 *
 * Pure — no Nuxt runtime.
 */
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'

export const BLOCK_SOURCES: Record<string, string> = {
  'bookings-locations': 'bookings',
  'bookings-filters': 'bookings',
  'bookings-package-list': 'bookings',
}

/**
 * The tree with every leaf in `BLOCK_SOURCES` that has no `source` given its
 * default one (splits and nested layouts walked). A leaf that already names a
 * source, and every other block, is left as it is.
 */
export function withBlockSources(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') {
    const source = BLOCK_SOURCES[node.blockId]
    return source && !node.source ? { ...node, source } : node
  }
  if (node.type === 'split') return { ...node, children: node.children.map(withBlockSources) }
  return { ...node, layout: { ...node.layout, root: withBlockSources(node.layout.root) } }
}
