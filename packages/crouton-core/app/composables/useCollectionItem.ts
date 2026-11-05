import type { Ref, ComputedRef } from 'vue'

interface CollectionItemReturn<T = any> {
  item: ComputedRef<T | null>
  pending: Ref<boolean>
  error: Ref<any>
  refresh: () => Promise<void>
}

/**
 * Fetch a single collection item by ID
 *
 * Features:
 * - Fetches individual items from the API
 * - Supports both team-scoped and super-admin routes
 * - Reactive ID parameter for prop changes
 * - Nuxt cache integration via useAsyncData
 * - Works with internal and external collections
 *
 * @example
 * // Basic usage
 * const { item, pending } = await useCollectionItem('users', '123')
 *
 * @example
 * // With reactive ID from props
 * const { item, pending } = await useCollectionItem('users', () => props.id)
 *
 * @example
 * // With ref
 * const userId = ref('123')
 * const { item, pending } = await useCollectionItem('users', userId)
 */
export async function useCollectionItem<T = any>(
  collection: string,
  id: string | Ref<string> | (() => string)
): Promise<CollectionItemReturn<T>> {
  const route = useRoute()
  const collections = useCollections()
  const config = collections.getConfig(collection)
  const { getTeamId } = useTeamContext()

  if (!config) {
    throw new Error(`Collection "${collection}" not registered`)
  }

  const apiPath = config.apiPath || collection

  // Handle all three types: string, Ref<string>, () => string
  const itemId = computed(() => {
    if (typeof id === 'function') return id()
    return unref(id)
  })

  const strategy = config.fetchStrategy || 'query'
  const isSuperAdmin = route.path.includes('/super-admin/')

  // Build API path based on collection's fetch strategy
  // - 'restful': Uses /{id} pattern (e.g., /api/teams/123/members/456)
  // - 'query': Uses ?ids= pattern (e.g., /api/teams/123/bookings?ids=456)
  const buildApiPath = (teamId: string | undefined) => {
    const basePath = isSuperAdmin
      ? `/api/super-admin/${apiPath}`
      : `/api/teams/${teamId}/${apiPath}`

    return strategy === 'restful'
      ? `${basePath}/${itemId.value}`
      : `${basePath}?ids=${itemId.value}`
  }

  // Skip server-side fetch when team context isn't available yet.
  // useAsyncData with server:false automatically fetches on client mount,
  // replacing the manual onMounted retry pattern.
  const canFetchOnServer = !!getTeamId() || isSuperAdmin

  // Forward the browser's auth cookie during SSR so team-scoped endpoints
  // see the user's better-auth session. On the client this is undefined.
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  const { data, pending, error, refresh } = await useAsyncData(
    `collection-item:${collection}:${itemId.value}`,
    () => {
      if (!itemId.value) return Promise.resolve(null)

      const currentTeamId = getTeamId()
      if (!currentTeamId && !isSuperAdmin) return Promise.resolve(null)

      return $fetch<any>(buildApiPath(currentTeamId), {
        headers: requestHeaders,
      })
    },
    {
      server: canFetchOnServer,
      watch: [itemId],
      default: () => null,
    }
  )

  // Handle response based on fetch strategy
  // - RESTful endpoints return single object
  // - Query-based endpoints return array (extract first item)
  const item = computed(() => {
    const response = data.value
    let rawItem: any = null

    if (strategy === 'restful') {
      rawItem = response
    } else {
      rawItem = Array.isArray(response) ? (response[0] || null) : response
    }

    return (rawItem as T | null) ?? null
  })

  return { item, pending, error, refresh }
}
