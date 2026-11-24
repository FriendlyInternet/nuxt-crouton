import type { Ref, ComputedRef } from 'vue'

export interface CollectionCacheKeys {
  /** Team part of every key: the team id, `'super-admin'`, or `''` before a team is known. */
  teamPart: ComputedRef<string>
  /** True on a `/super-admin/` route (no team). */
  isSuperAdmin: ComputedRef<boolean>
  /** `collection-item:<collection>:<team>:<id>` */
  itemKey: (id: string) => string
  /** `collection:<collection>:<team>:<query JSON | {}>` */
  listKey: (query?: Record<string, any> | null) => string
  /** Refresh every cached list of this collection in the current team (plus the `{}` key). */
  refreshLists: () => Promise<void>
  /** Refresh the exact item keys of these ids in the current team (optionally of another collection). */
  refreshItems: (ids: string | string[], otherCollection?: string) => Promise<void>
}

/**
 * The ONE place that names collection cache slots (#4506).
 *
 * Every list key and item key carries the team, so a save in one team never
 * refreshes another team's lists or records. Call at setup: the team source
 * (`useTeam()`) and the route are resolved once here, never inside a key getter
 * or a refresh, because Nuxt re-evaluates those outside setup.
 *
 * @example
 * const { listKey, refreshLists } = useCollectionCacheKeys('products')
 * await refreshLists()
 */
export function useCollectionCacheKeys(collection: string): CollectionCacheKeys {
  const route = useRoute()

  let currentTeam: Ref<{ id?: string } | null | undefined> | undefined
  try {
    currentTeam = useTeam().currentTeam as Ref<{ id?: string } | null | undefined>
  } catch {
    // App has no useTeam — fall back to the route param below
  }

  const isSuperAdmin = computed(() => route.path.includes('/super-admin/'))

  // Same order as getTeamId(): useTeam().currentTeam.id, then the route param.
  // Super-admin has no team.
  const teamPart = computed(() => {
    if (isSuperAdmin.value) return 'super-admin'
    if (currentTeam?.value?.id) return currentTeam.value.id
    const teamParam = route.params?.team
    return typeof teamParam === 'string' ? teamParam : ''
  })

  const itemKey = (id: string) => `collection-item:${collection}:${teamPart.value}:${id}`

  const listKey = (query?: Record<string, any> | null) =>
    `collection:${collection}:${teamPart.value}:${query ? JSON.stringify(query) : '{}'}`

  async function refreshLists() {
    const nuxtApp = useNuxtApp()
    const prefix = `collection:${collection}:${teamPart.value}:`
    const cached = Object.keys(nuxtApp.payload?.data ?? {}).filter(key => key.startsWith(prefix))
    const keys = [...new Set([...cached, listKey()])]
    await Promise.all(keys.map(key => refreshNuxtData(key)))
  }

  async function refreshItems(ids: string | string[], otherCollection?: string) {
    const target = otherCollection ?? collection
    const list = (Array.isArray(ids) ? ids : [ids]).filter(
      (id): id is string => typeof id === 'string' && !!id
    )
    await Promise.all(
      list.map(id => refreshNuxtData(`collection-item:${target}:${teamPart.value}:${id}`))
    )
  }

  return { teamPart, isSuperAdmin, itemKey, listKey, refreshLists, refreshItems }
}
