/**
 * The server-side query registry, shared between an app and the packages it extends (#2309).
 *
 * `crouton config` generates `server/utils/crouton-query-registry.ts` in the app, listing the
 * collections the app generated. Since #2278 the sales, bookings, pages and assets collections
 * ship from their packages and never appear there, so a public collection-binder page bound to
 * one of them answered "not found". Each owning package now registers its own entries into
 * ONE process-wide map (a Nitro plugin, `server/plugins/query-registry.ts`), and the consumers
 * read the union through `resolveQueryRegistry`. The app's generated entry wins on a clash.
 *
 * The entry shape is the generated one: `getAll`/`getByIds` return a promise of the query
 * function, so the queries module is only imported when a collection is actually queried.
 */
export interface CollectionQueries {
  getAll: () => Promise<(teamId: string, ...rest: any[]) => Promise<any[]>>
  getByIds: () => Promise<(teamId: string, ids: string[]) => Promise<any[]>>
}

export type QueryRegistry = Record<string, CollectionQueries>

export const QUERY_REGISTRY_KEY = '__crouton_query_registry'

/** Merge a package's entries into the process-wide registry (creating it on first use). */
export function registerCollectionQueries(entries: QueryRegistry): void {
  const g = globalThis as Record<string, any>
  g[QUERY_REGISTRY_KEY] = { ...(g[QUERY_REGISTRY_KEY] ?? {}), ...entries }
}

/**
 * Package entries + the app's generated registry (if it has one), app winning on a clash.
 * Never creates the global: an app with nothing registered gets `{}`.
 */
export function resolveQueryRegistry(appRegistry?: Record<string, unknown> | null): QueryRegistry {
  const packages = (globalThis as Record<string, any>)[QUERY_REGISTRY_KEY] ?? {}
  return { ...packages, ...(appRegistry ?? {}) } as QueryRegistry
}

/**
 * The entry for one collection, from a lazy import of its queries module and the generated
 * function-name stem: `collectionQueries(() => import('./queries'), 'SalesProducts')` resolves
 * `getAllSalesProducts` / `getSalesProductsByIds`.
 */
export function collectionQueries(load: () => Promise<Record<string, any>>, name: string): CollectionQueries {
  return {
    getAll: () => load().then(m => m[`getAll${name}`]),
    getByIds: () => load().then(m => m[`get${name}ByIds`]),
  }
}
