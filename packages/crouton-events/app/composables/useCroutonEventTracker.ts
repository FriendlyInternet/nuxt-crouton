/**
 * Event tracker composable for Crouton collections
 * Provides smart diff tracking and event persistence
 */
import type { EventChange } from '../types/events'

interface TrackEventOptions {
  operation: 'create' | 'update' | 'delete'
  collection: string
  itemId?: string
  itemIds?: string[]
  data?: any
  updates?: any
  result?: any
  beforeData?: any
}

export function useCroutonEventTracker() {
  // crouton-auth's session (better-auth). This was `useUserSession()` — the nuxt-auth-utils API,
  // which crouton doesn't install — so every app extending this package 500'd on SSR (#2602).
  const { user } = useSession()
  const config = useRuntimeConfig()
  // Get team context at setup time to avoid calling composables in async callbacks
  const { getTeamId } = useTeamContext()

  /**
   * Build smart diff - only include changed fields
   */
  const buildChangesDiff = (before: any, after: any): EventChange[] => {
    const changes: EventChange[] = []

    // For CREATE operations (no before data)
    if (!before && after) {
      Object.keys(after).forEach((key) => {
        // Skip internal/metadata fields
        if (['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'teamId', 'owner'].includes(key)) {
          return
        }

        changes.push({
          fieldName: key,
          oldValue: null,
          newValue: JSON.stringify(after[key])
        })
      })
      return changes
    }

    // For UPDATE operations (compare before and after)
    if (before && after) {
      Object.keys(after).forEach((key) => {
        // Skip internal/metadata fields
        if (['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'teamId', 'owner'].includes(key)) {
          return
        }

        const oldValue = before[key]
        const newValue = after[key]

        // Only track if value actually changed
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes.push({
            fieldName: key,
            oldValue: JSON.stringify(oldValue),
            newValue: JSON.stringify(newValue)
          })
        }
      })
      return changes
    }

    // For DELETE operations (only before data)
    if (before && !after) {
      Object.keys(before).forEach((key) => {
        // Skip internal/metadata fields
        if (['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'teamId', 'owner'].includes(key)) {
          return
        }

        changes.push({
          fieldName: key,
          oldValue: JSON.stringify(before[key]),
          newValue: null
        })
      })
      return changes
    }

    return changes
  }

  /**
   * Track an event asynchronously (non-blocking)
   */
  const track = async (options: TrackEventOptions): Promise<void> => {
    const { operation, collection, itemId, itemIds, data, updates, result, beforeData } = options

    // Skip if tracking is disabled
    if (!config.public.croutonEvents?.enabled) {
      return
    }

    // Get user info
    if (!user.value) {
      console.warn('[CroutonEvents] Cannot track event: No user session')
      return
    }

    const userId = user.value.id
    const userName = config.public.croutonEvents.snapshotUserName
      ? (user.value.name || user.value.email || 'Unknown User')
      : ''

    // Build changes based on operation
    let changes: EventChange[] = []

    switch (operation) {
      case 'create':
        // For create: all fields are new
        changes = buildChangesDiff(null, data || result)
        break

      case 'update':
        // For update: compare before and after
        // We need beforeData to calculate the diff
        if (beforeData && result) {
          changes = buildChangesDiff(beforeData, result)
        } else if (updates) {
          // Fallback: Just track the updates as changes
          changes = Object.keys(updates).map(key => ({
            fieldName: key,
            oldValue: null, // We don't have the old value
            newValue: JSON.stringify(updates[key])
          }))
        }
        break

      case 'delete':
        // For delete: all fields are removed
        changes = buildChangesDiff(beforeData || {}, null)
        break
    }

    // Prepare event data
    const eventData = {
      timestamp: new Date(),
      operation,
      collectionName: collection,
      itemId: itemId || (itemIds && itemIds[0]) || '',
      userId,
      userName,
      changes,
      metadata: {
        // Optional: Add more context here
        userAgent: import.meta.client ? navigator.userAgent : undefined
      }
    }

    // Track the event via API (fire and forget)
    try {
      const teamId = getTeamId()

      if (!teamId) {
        console.warn('[CroutonEvents] Cannot track event: No team context')
        return
      }

      // Use the generated API endpoint for collection events
      await $fetch(`/api/teams/${teamId}/crouton-collection-events`, {
        method: 'POST',
        body: eventData,
        credentials: 'include'
      })
    } catch (error) {
      // Error will be handled by the caller (plugin with Option 1 error handling)
      throw error
    }
  }

  /**
   * Track event in background (fire and forget with error handling)
   */
  const trackInBackground = (options: TrackEventOptions): void => {
    track(options).catch((err) => {
      // Silently log in production, toast in development
      if (import.meta.dev) {
        console.error('[CroutonEvents] Background tracking failed:', err)
      } else {
        console.warn('[CroutonEvents] Background tracking failed:', err.message)
      }
    })
  }

  return {
    track,
    trackInBackground
  }
}
