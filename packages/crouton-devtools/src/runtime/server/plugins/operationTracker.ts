/**
 * Nitro Plugin - Operation Tracker
 *
 * Tracks all CRUD operations to Crouton collection endpoints.
 * Runs as a Nitro plugin using the onAfterResponse hook.
 */

import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime'
// Nuxt's useAppConfig (via #imports) includes the layers' app.config.ts files, where
// collections register; nitropack/runtime's only has the inline config (#3255).
import { useAppConfig } from '#imports'
import type { NitroApp } from 'nitropack'
import { operationStore, type Operation } from '../utils/operationStore'
import { buildApiPathIndex, classifyRequest, type TrackedPrefix } from '../utils/routeParse'
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
  const runtimePrefixes: TrackedPrefix[] =
    (useRuntimeConfig() as any).croutonDevtools?.apiRoutePrefixes ?? []

  const TRACKED_PREFIXES: TrackedPrefix[] = [
    { prefix: '/api/crouton-collection/', routeGroup: 'collection' },
    ...runtimePrefixes
  ]

  // #3255: generated collections are served at /api/teams/<teamId>/<apiPath>. Map each
  // registered collection's apiPath → name, read from app config on first use (layers
  // register collections in app.config.ts, so they're only complete at runtime).
  let apiPathIndex: Map<string, string> | undefined
  const getApiPathIndex = () =>
    (apiPathIndex ??= buildApiPathIndex((useAppConfig() as any).croutonCollections ?? {}))

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

    const tracked = classifyRequest(method, path, TRACKED_PREFIXES, getApiPathIndex())
    if (!tracked) {
      return
    }

    requestTimings.set(event.node.req as any, { startTime: Date.now(), id: generateId(), path, method, ...tracked })
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
