/**
 * Nitro Plugin - Operation Tracker
 *
 * Tracks all CRUD operations to Crouton collection endpoints.
 * Runs as a Nitro plugin using the onAfterResponse hook.
 */

import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
import type { NitroApp } from 'nitropack'
import { operationStore, type Operation } from '../utils/operationStore'
import { extractCollectionName, extractItemId, extractRouteLabel, detectOperation } from '../utils/routeParse'
import { systemOperationStore } from '../utils/systemOperationStore'

/**
 * Generate unique ID for operation
 */
function generateId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export default defineNitroPlugin((nitroApp: NitroApp) => {
  // Only track in development
  if (process.env.NODE_ENV !== 'development') {
    return
  }

  // Build tracked prefix list: collection routes are always included;
  // additional prefixes come from croutonApps.*.apiRoutes via runtimeConfig.
  const runtimePrefixes: Array<{ prefix: string, routeGroup: string }> =
    (useRuntimeConfig() as any).croutonDevtools?.apiRoutePrefixes ?? []

  const TRACKED_PREFIXES: Array<{ prefix: string, routeGroup: string }> = [
    { prefix: '/api/crouton-collection/', routeGroup: 'collection' },
    ...runtimePrefixes
  ]

  /**
   * Find the tracked prefix entry that matches a given path.
   * Returns undefined if the path is not tracked.
   */
  function matchPrefix(path: string): { prefix: string, routeGroup: string } | undefined {
    return TRACKED_PREFIXES.find(({ prefix }) => path.startsWith(prefix))
  }

  // Track request timing
  const requestTimings = new Map<string, {
    startTime: number
    id: string
    path: string
    method: string
    collection: string
    operation: Operation['operation']
    itemId?: string
    routeGroup: string
  }>()

  // Subscribe to crouton:operation for system event tracking
  nitroApp.hooks.hook('crouton:operation', (payload) => {
    systemOperationStore.add({
      id: `sop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: payload.timestamp ?? Date.now(),
      type: payload.type,
      source: payload.source,
      teamId: payload.teamId,
      userId: payload.userId,
      correlationId: payload.correlationId,
      metadata: payload.metadata
    })
  })

  // Hook: Before request
  nitroApp.hooks.hook('request', (event) => {
    const path = event.path || event.node.req.url || ''
    const method = event.method || event.node.req.method || 'GET'

    const matched = matchPrefix(path)
    if (!matched) {
      return
    }

    const id = generateId()
    // For collection routes, extract the collection name from the path.
    // For other routes, use the last meaningful path segment as the "collection" label.
    const collection = matched.routeGroup === 'collection'
      ? extractCollectionName(path)
      : extractRouteLabel(path, matched.prefix)
    const operation = detectOperation(method, path)
    const itemId = matched.routeGroup === 'collection' ? extractItemId(path) : undefined

    requestTimings.set(event.node.req as any, {
      startTime: Date.now(),
      id,
      path,
      method,
      collection,
      operation,
      itemId,
      routeGroup: matched.routeGroup
    })
  })

  // Hook: After response
  nitroApp.hooks.hook('afterResponse', (event) => {
    const timing = requestTimings.get(event.node.req as any)

    if (!timing) {
      return
    }

    const duration = Date.now() - timing.startTime
    const status = event.node.res.statusCode || 200
    const teamContext = (event.context as any).team?.id

    operationStore.add({
      id: timing.id,
      timestamp: timing.startTime,
      collection: timing.collection,
      operation: timing.operation,
      method: timing.method,
      path: timing.path,
      status,
      duration,
      teamContext,
      error: status >= 400 ? `HTTP ${status}` : undefined,
      itemId: timing.itemId,
      routeGroup: timing.routeGroup
    })

    // Clean up
    requestTimings.delete(event.node.req as any)
  })
})
