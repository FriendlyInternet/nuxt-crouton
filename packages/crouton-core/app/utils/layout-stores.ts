/**
 * `collectLayoutStores` (#3650) — the full list of store copies one layout needs,
 * in one pass, so a `CroutonLayoutStoreScope` can create every copy up front.
 *
 * Walks `tree.root`, every `tree.breakpoints[].root` and every nested sub-layout
 * (recursively, with its own breakpoints and `sources`). Collects each leaf's
 * `source` and each key of any `sources` map. Options come from the `sources`
 * maps; outer levels are processed first and an inner level never overwrites a
 * key already set (the outer level wins). The result is sorted by `source`, so it
 * is the same whatever the order of children or breakpoints.
 *
 * Pure (no Nuxt runtime), auto-imported from crouton-core.
 */
import type { LayoutNode, LayoutStoreEntry, LayoutTree } from '../types/layout'

/** Same cap as the layout-tree gate — a looping tree can't blow the stack. */
const MAX_DEPTH = 24

type Options = Map<string, Record<string, unknown> | undefined>

export function collectLayoutStores(tree: LayoutTree): LayoutStoreEntry[] {
  const used = new Set<string>()
  const options: Options = new Map()
  // Nested trees are queued and processed after their parent level, so every
  // outer `sources` map is applied before any inner one.
  let level: LayoutTree[] = [tree]
  for (let depth = 0; level.length && depth <= MAX_DEPTH; depth++) {
    const next: LayoutTree[] = []
    for (const t of level) collectTree(t, used, options, next)
    level = next
  }
  return [...used].sort().map(source => toEntry(source, options.get(source)))
}

function toEntry(source: string, options: Record<string, unknown> | undefined): LayoutStoreEntry {
  return options ? { source, options } : { source }
}

/** One tree level: its `sources` keys (first writer wins), then its root + breakpoint roots. */
function collectTree(t: LayoutTree, used: Set<string>, options: Options, nested: LayoutTree[]): void {
  for (const [key, value] of Object.entries(t.sources ?? {})) addSource(key, value?.options, used, options)
  walk(t.root, used, nested)
  for (const bp of t.breakpoints ?? []) {
    if (bp.root) walk(bp.root, used, nested)
  }
}

function addSource(key: string, opts: Record<string, unknown> | undefined, used: Set<string>, options: Options): void {
  if (!key) return
  used.add(key)
  if (!options.has(key)) options.set(key, opts)
}

function walk(node: LayoutNode, used: Set<string>, nested: LayoutTree[], depth = 0): void {
  if (depth > MAX_DEPTH) return
  if (node.type === 'leaf') {
    if (typeof node.source === 'string' && node.source) used.add(node.source)
  } else if (node.type === 'split') {
    for (const child of node.children) walk(child, used, nested, depth + 1)
  } else if (node.type === 'nested') {
    nested.push(node.layout)
  }
}
