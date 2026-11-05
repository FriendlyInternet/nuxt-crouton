// v1.0.2 - Removed debug console.log statements for production
/**
 * useCrouton - Modal and form state management
 *
 * NOTE: This composable manages modal/form UI state. Pagination state was
 * extracted into `useCroutonPagination()` — the methods are still surfaced
 * here for backward compat with consumers that grab everything off useCrouton.
 *
 * For data operations, use:
 * - useCollectionQuery() for fetching data
 * - useCollectionMutation() for create/update/delete
 */

// Type definitions - exported for use in components
export type CroutonAction = 'create' | 'update' | 'delete' | 'view' | undefined
export type LoadingState = 'notLoading' | 'create_send' | 'update_send' | 'delete_send' | 'view_send' | 'create_open' | 'update_open' | 'delete_open' | 'view_open'

export interface CroutonState {
  id: string
  action: CroutonAction
  collection: string | null
  activeItem: any
  items: any[]
  loading: LoadingState
  isOpen: boolean
  containerType: 'slideover' | 'modal' | 'dialog' | 'inline'
  isExpanded?: boolean // Track expand state for slideovers
}

export default function () {
  const route = useRoute()
  const { getTeamId } = useTeamContext()

  // Pagination methods are owned by useCroutonPagination — re-exposed here
  // for backward compat with existing call sites that destructure them off useCrouton().
  const { pagination, setPagination, getPagination, getDefaultPagination } = useCroutonPagination()

  // useState - now using array of states for multiple slideovers
  const croutonStates = useState<CroutonState[]>('croutonStates', () => [])
  const MAX_DEPTH = 5 // Maximum nesting depth

  // Computed values for backward compatibility
  const showCrouton = computed(() => croutonStates.value.length > 0)
  const loading = computed(() => croutonStates.value[croutonStates.value.length - 1]?.loading || 'notLoading')
  const action = computed(() => croutonStates.value[croutonStates.value.length - 1]?.action || undefined)
  const activeCollection = computed(() => croutonStates.value[croutonStates.value.length - 1]?.collection || null)
  const items = computed(() => croutonStates.value[croutonStates.value.length - 1]?.items || [])
  const activeItem = computed(() => croutonStates.value[croutonStates.value.length - 1]?.activeItem || {})

  const open = async (actionIn: CroutonAction, collection: string, ids: string[] = [], container: 'slideover' | 'modal' | 'dialog' | 'inline' = 'slideover', initialData?: any): Promise<void> => {
    const hasErrors = useCroutonError().foundErrors()
    if (hasErrors) {
      return
    }

    // Check if we've reached maximum depth
    if (croutonStates.value.length >= MAX_DEPTH) {
      const notify = useNotify()
      const { t } = useT()
      notify.warning(t('form.maxDepthTitle'), { description: t('form.maxDepthDescription', { count: MAX_DEPTH }) })
      return
    }

    // Create new state object
    const newState: CroutonState = {
      id: `crouton-${Date.now()}-${Math.random()}`,
      action: actionIn,
      collection: collection,
      activeItem: {},
      items: [],
      loading: `${actionIn}_open` as LoadingState,
      isOpen: true,
      containerType: container
    }

    // Add new state to array
    croutonStates.value.push(newState)

    if (actionIn === 'update' || actionIn === 'view') {
      try {
        // Get the apiPath from config
        const collections = useCollections()
        const config = collections.getConfig(collection)
        const apiPath = config?.apiPath || collection
        const fetchStrategy = config?.fetchStrategy || 'query'

        // Determine base API path
        let basePath: string
        if (route.path.includes('/super-admin/')) {
          basePath = `/api/super-admin/${apiPath}`
        } else {
          const teamId = getTeamId()
          if (!teamId) {
            throw new Error('Team context required to open form')
          }
          basePath = `/api/teams/${teamId}/${apiPath}`
        }

        // Build full path based on fetch strategy
        let fullApiPath: string
        let queryParams: Record<string, any> = {}

        if (fetchStrategy === 'restful') {
          // RESTful: /api/teams/{teamId}/{collection}/{itemId}
          fullApiPath = `${basePath}/${ids[0]}`
        } else {
          // Query-based: /api/teams/{teamId}/{collection}?ids=x,y,z
          fullApiPath = basePath
          queryParams = { ids: ids.join(',') }
        }

        // Fetch the item to edit
        const response = await $fetch<any>(fullApiPath, {
          method: 'GET',
          query: queryParams,
          credentials: 'include'
        })

        // Extract the active item from response
        let activeItem: any
        if (response?.items && response?.pagination) {
          activeItem = Array.isArray(response.items) ? response.items[0] : response.items
        } else {
          activeItem = Array.isArray(response) ? response[0] : response
        }

        // Update the state
        const stateIndex = croutonStates.value.findIndex((s: CroutonState) => s.id === newState.id)
        if (stateIndex !== -1) {
          croutonStates.value[stateIndex] = {
            ...croutonStates.value[stateIndex],
            activeItem: activeItem,
            loading: 'notLoading'
          } as CroutonState
        }
        return
      } catch (error) {
        const notify = useNotify()
        const { t } = useT()
        notify.error(t('form.somethingWentWrong'), { description: String(error) })
        croutonStates.value.pop()
        return
      }
    }

    if (actionIn === 'create') {
      newState.activeItem = initialData || {}
    }

    if (actionIn === 'delete') {
      newState.items = ids
    }

    // Set loading to notLoading
    newState.loading = 'notLoading'
  }

  const close = (stateId?: string): void => {
    if (stateId) {
      // Find the state and set isOpen to false to trigger animation
      const state = croutonStates.value.find((s: CroutonState) => s.id === stateId)
      if (state) {
        state.isOpen = false
      }
    } else {
      // Close the topmost state (backward compatibility)
      const topState = croutonStates.value[croutonStates.value.length - 1]
      if (topState) {
        topState.isOpen = false
      }
    }
  }

  // New function to actually remove the state from the array (called after animation)
  const removeState = (stateId: string): void => {
    const index = croutonStates.value.findIndex((s: CroutonState) => s.id === stateId)
    if (index !== -1) {
      croutonStates.value.splice(index, 1)
    }
  }

  // New function to close all states
  const closeAll = (): void => {
    // Set all states to closed to trigger animations
    croutonStates.value.forEach((state: CroutonState) => {
      state.isOpen = false
    })
    // After a delay, clear all states (fallback in case after:leave doesn't fire)
    setTimeout(() => {
      croutonStates.value = []
    }, 300)
  }

  // Reset function for navigation scenarios
  const reset = (): void => {
    croutonStates.value = []
  }

  return {
    // Modal state
    showCrouton,
    loading,
    action,
    items,
    activeItem,
    activeCollection,
    croutonStates,

    // Modal actions
    open,
    close,
    closeAll,
    removeState,
    reset,

    // Pagination (still needed for some components)
    pagination,
    setPagination,
    getPagination,
    getDefaultPagination
  }
}
