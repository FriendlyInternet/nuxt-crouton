import { inject, provide, useId, type InjectionKey } from 'vue'
import type { CroutonLayoutStoreDefinition, LayoutStoreEntry } from '@fyit/crouton-core/app/types/layout'

/**
 * Layout store scope (#3650) — one place that owns every store copy a layout's
 * blocks are fed from.
 *
 * NOT `useCroutonLayoutStore` (that loads/saves a layout tree). These are DATA
 * stores registered with `defineCroutonLayoutStore` (crouton-core) and fed to
 * blocks as props + events through `useLayoutLeafBinding`.
 *
 * `provideLayoutStoreScope(stores)` creates every copy **synchronously in the
 * caller's setup**, so each copy's watchers and keyed `useFetch` belong to the
 * scope component: a block unmounting, or a renderer re-keying at a breakpoint,
 * never stops or re-creates them. Each copy gets `ctx.key =
 * layout-store:<useId()>:<source>`, so two scopes (and `test` vs `test#2`) never
 * share fetched data. Copies are never created later from a block's setup.
 */
export interface LayoutStoreScopeEntry {
  def: CroutonLayoutStoreDefinition
  store: unknown
}
export type LayoutStoreScope = Map<string, LayoutStoreScopeEntry>

export const LAYOUT_STORE_SCOPE_KEY: InjectionKey<LayoutStoreScope> = Symbol('crouton-layout-store-scope')

/** The store id a source names: the part before `#` (`'bookings#mine'` → `'bookings'`). */
export function layoutStoreId(source: string): string {
  return source.split('#')[0] ?? source
}

/** Create one copy per entry (in the caller's setup) and provide them. Returns the scope. */
export function provideLayoutStoreScope(stores: LayoutStoreEntry[]): LayoutStoreScope {
  const scopeId = useId()
  const scope: LayoutStoreScope = new Map()
  // Only reach for the registry when there is something to create, so a layout
  // with no sources needs no registered stores at all.
  const registry = stores.length ? useCroutonLayoutStoreRegistry() : null
  for (const { source, options } of stores) {
    if (scope.has(source)) continue
    const def = registry?.get(layoutStoreId(source))
    if (!def) {
      if (import.meta.dev !== false) console.warn(`[crouton-layout] no layout store is registered for source "${source}".`)
      continue
    }
    const store = def.setup({ key: `layout-store:${scopeId}:${source}`, source, options: options ?? {} })
    scope.set(source, { def, store })
  }
  provide(LAYOUT_STORE_SCOPE_KEY, scope)
  return scope
}

/** The surrounding scope, or `null` when there is none. */
export function injectLayoutStoreScope(): LayoutStoreScope | null {
  return inject(LAYOUT_STORE_SCOPE_KEY, null)
}
