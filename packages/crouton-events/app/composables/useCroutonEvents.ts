/**
 * Enriched events query composable
 * Extends standard collection query with user JOIN support
 *
 * `options` may be a plain object, a ref or a getter — the query re-runs when it changes.
 */
import type { MaybeRefOrGetter } from 'vue'
import type { EventQueryOptions } from '../utils/event-display'

type UseCroutonEventsOptions = EventQueryOptions

interface EnrichedEvent {
  id: string
  timestamp: Date
  operation: 'create' | 'update' | 'delete'
  collectionName: string
  itemId: string
  teamId: string
  userId: string
  userName: string // Historical snapshot
  changes: any[]
  metadata?: any
  // Enriched user data (if enrichUserData: true)
  user?: {
    id: string
    currentName?: string
    email?: string
    avatarUrl?: string
  }
}

export function useCroutonEvents(options: MaybeRefOrGetter<UseCroutonEventsOptions> = {}) {
  const { getTeamId } = useTeamContext()
  const teamId = toValue(options).teamId || getTeamId()

  if (!teamId) {
    throw new Error('[useCroutonEvents] Team context required')
  }

  // Reactive: useFetch re-runs whenever the computed query changes (filters, page)
  const query = computed(() => buildEventQuery({ ...toValue(options), teamId }))

  const { data, pending, error, refresh } = useFetch<EnrichedEvent[]>(
    `/api/teams/${teamId}/crouton-events`,
    { query }
  )

  return {
    data,
    pending,
    error,
    refresh
  }
}
