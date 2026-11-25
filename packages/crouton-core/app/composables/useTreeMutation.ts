/**
 * Tree mutation composable for hierarchy operations
 * Handles move and reorder operations for tree-structured collections
 *
 * Features:
 * - Move nodes to new parents (or root)
 * - Reorder siblings within the same parent
 * - Automatic cache invalidation after mutations
 * - Visual feedback via row flash animation (useTreeItemState)
 * - Toast notifications for errors only
 *
 * @example
 * const { moveNode, reorderSiblings, moving } = useTreeMutation('pages')
 *
 * // Move a page to a new parent
 * await moveNode('page-id', 'new-parent-id', 2)
 *
 * // Move to root level
 * await moveNode('page-id', null, 0)
 *
 * // Reorder siblings
 * await reorderSiblings([
 *   { id: 'page-1', order: 0 },
 *   { id: 'page-2', order: 1 },
 *   { id: 'page-3', order: 2 }
 * ])
 */
export function useTreeMutation(collection: string) {
  const route = useRoute()
  const notify = useNotify()
  const { t } = useT()
  const collections = useCollections()
  const config = collections.getConfig(collection)
  const { getTeamId } = useTeamContext()
  const { markSaving, markSaved, markError, triggerCountFlash } = useTreeItemState()
  // The one cache-key builder (#4506): refreshes the current team's lists only
  const { refreshLists } = useCollectionCacheKeys(collection)

  if (!config) {
    console.error(`[useTreeMutation] Collection "${collection}" not found in registry`)
    throw new Error(`Collection "${collection}" not registered`)
  }

  const apiPath = config.apiPath || collection

  // Determine if this is a sortable-only collection (no parent nesting allowed)
  const isSortableOnly = config.sortable?.enabled && !config.hierarchy?.enabled

  // Track loading state
  const moving = ref(false)
  const reordering = ref(false)

  /**
   * Get the correct API base path for the current context
   */
  const getApiBasePath = () => {
    if (route.path.includes('/super-admin/')) {
      return `/api/super-admin/${apiPath}`
    }

    const teamId = getTeamId()
    if (!teamId) {
      console.error('[useTreeMutation] Team context required but not available')
      throw new Error('Team context required for this operation')
    }

    return `/api/teams/${teamId}/${apiPath}`
  }

  /**
   * Invalidate cache for this collection in the current team (triggers refetch in its views).
   * Refreshes the current team's cache keys for the collection — including scoped queries like
   * `{"eventId":...}` — matching useCollectionMutation. Previously this only refreshed
   * the empty-query key (`collection:X:{}`), so a reorder left event-scoped views stale
   * (and effectively pulled the un-scoped, team-wide set).
   */
  const invalidateCache = () => refreshLists()

  /**
   * Move a node to a new parent and/or position
   *
   * For sortable-only collections (no hierarchy), this uses the /reorder endpoint
   * and ignores the parentId parameter since nesting is not allowed.
   *
   * @param id - The ID of the item to move
   * @param newParentId - The new parent ID (null for root level) - ignored for sortable-only
   * @param newOrder - The new order position within the parent
   */
  const moveNode = async (
    id: string,
    newParentId: string | null,
    newOrder: number
  ): Promise<void> => {
    const baseUrl = getApiBasePath()

    // For sortable-only collections, use reorder endpoint instead of move
    if (isSortableOnly) {
      // Fetch current items to calculate new order for ALL siblings
      const items = await $fetch<Array<{ id: string; order?: number }>>(baseUrl, {
        credentials: 'include'
      })

      // Sort by current order
      const sortedItems = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

      // Find current index of moved item
      const currentIndex = sortedItems.findIndex(item => item.id === id)
      if (currentIndex === -1) {
        console.error('[useTreeMutation] Moved item not found in collection')
        return
      }

      // Remove item from current position and insert at new position
      const [movedItem] = sortedItems.splice(currentIndex, 1)
      if (!movedItem) {
        console.error('[useTreeMutation] Failed to splice moved item')
        return
      }
      sortedItems.splice(newOrder, 0, movedItem)

      // Calculate new order values for ALL items
      const updates = sortedItems.map((item, index) => ({
        id: item.id,
        order: index
      }))

      await reorderSiblings(updates)
      return
    }

    // Full hierarchy mode - use the /move endpoint
    const url = `${baseUrl}/${id}/move`
    const correlationId = generateCorrelationId()
    const timestamp = Date.now()

    moving.value = true
    markSaving(id)

    try {
      await $fetch(url, {
        method: 'PATCH',
        body: {
          parentId: newParentId,
          order: newOrder
        },
        credentials: 'include'
      })

      // Visual feedback via row flash animation - call BEFORE cache invalidation
      // so the state is set before the tree re-renders
      markSaved(id)

      // Flash the child count badge on the new parent (if not root)
      if (newParentId) {
        triggerCountFlash(newParentId)
      }

      // Emit hook for event tracking
      const nuxtApp = useNuxtApp()
      await nuxtApp.hooks.callHook('crouton:mutation', {
        operation: 'move',
        collection,
        itemId: id,
        data: { parentId: newParentId, order: newOrder },
        correlationId,
        timestamp
      })

      // Invalidate cache to trigger refetch
      await invalidateCache()
    } catch (error: any) {
      markError(id)

      const errorMessage = error.data?.message || error.data || t('mutations.moveFailed')

      notify.error(t('mutations.moveFailed'), { description: errorMessage })

      throw error
    } finally {
      moving.value = false
    }
  }

  /**
   * Reorder siblings within the same parent
   *
   * @param updates - Array of { id, order } objects
   */
  const reorderSiblings = async (
    updates: Array<{ id: string, order: number }>
  ): Promise<void> => {
    const baseUrl = getApiBasePath()
    const url = `${baseUrl}/reorder`
    const correlationId = generateCorrelationId()
    const timestamp = Date.now()

    reordering.value = true

    try {
      await $fetch(url, {
        method: 'PATCH',
        body: { updates },
        credentials: 'include'
      })

      // Emit hook for event tracking
      const nuxtApp = useNuxtApp()
      await nuxtApp.hooks.callHook('crouton:mutation', {
        operation: 'reorder',
        collection,
        data: { updates },
        correlationId,
        timestamp
      })

      // Invalidate cache to trigger refetch
      await invalidateCache()

      // Visual feedback via row flash animation for all reordered items
      updates.forEach(update => markSaved(update.id))
    } catch (error: any) {
      const errorMessage = error.data?.message || error.data || t('mutations.reorderFailed')

      notify.error(t('mutations.reorderFailed'), { description: errorMessage })

      throw error
    } finally {
      reordering.value = false
    }
  }

  return {
    moveNode,
    reorderSiblings,
    moving: readonly(moving),
    reordering: readonly(reordering)
  }
}
