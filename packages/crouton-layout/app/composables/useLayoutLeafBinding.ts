import { computed, watch, type ComputedRef, type Ref } from 'vue'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { injectLayoutStoreScope, type LayoutStoreScope } from './useLayoutStoreScope'

export interface LayoutLeafBinding {
  /** Props the store's feed gives this block. */
  props: Record<string, unknown>
  /** `onX` handlers routing the block's events to the store's intents. */
  on: Record<string, (...args: unknown[]) => void>
}

const EMPTY: LayoutLeafBinding = { props: {}, on: {} }

/** `bump` → `onBump`, `select-day` → `onSelectDay` (Vue's listener prop names). */
function listenerName(event: string): string {
  const camel = event.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
  return `on${camel.charAt(0).toUpperCase()}${camel.slice(1)}`
}

/**
 * The one "feed this block from its store" helper (#3650): looks up the leaf's
 * `source` in the surrounding `CroutonLayoutStoreScope`, finds that store's feed
 * for the leaf's `blockId`, and returns the props it gives + `onX` handlers that
 * route the block's events to the store. A block never touches the scope itself.
 *
 * No `source` → empty binding. A source the scope doesn't have, or a store with
 * no feed for this block → empty binding + a one-time dev warning.
 *
 * `scope` defaults to the injected one; a renderer that provides its own scope
 * passes it in (a component can't inject what it provides itself).
 */
export function useLayoutLeafBinding(
  leaf: Ref<LayoutNode>,
  scope: LayoutStoreScope | null = injectLayoutStoreScope(),
): ComputedRef<LayoutLeafBinding> {
  const resolved = computed(() => {
    const node = leaf.value
    if (node.type !== 'leaf' || !node.source) return { missing: null, binding: EMPTY }
    const entry = scope?.get(node.source)
    const feed = entry?.def.feeds[node.blockId]
    if (!entry || !feed) return { missing: `${node.source}|${node.blockId}`, binding: EMPTY }
    const store = entry.store
    const on: Record<string, (...args: unknown[]) => void> = {}
    for (const [name, fn] of Object.entries(feed.events ?? {})) {
      on[listenerName(name)] = (...args: unknown[]) => fn(store, ...args)
    }
    return { missing: null, binding: { props: feed.props?.(store) ?? {}, on } }
  })

  const warned = new Set<string>()
  watch(() => resolved.value.missing, (missing) => {
    if (!missing || warned.has(missing) || import.meta.dev === false) return
    warned.add(missing)
    const [source, blockId] = missing.split('|')
    const why = scope?.has(source!) ? `its store has no feed for block "${blockId}"` : 'the surrounding layout store scope has no such source'
    console.warn(`[crouton-layout] block "${blockId}" asks for layout store source "${source}", but ${why}; it gets no store.`)
  }, { immediate: true })

  return computed(() => resolved.value.binding)
}
