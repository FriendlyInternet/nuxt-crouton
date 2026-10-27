/**
 * Standalone Cloudflare Worker that hosts the CollabRoom Durable Object.
 *
 * Cloudflare Pages cannot host Durable Objects directly — they must live
 * in a separate Worker. Pages apps reference this worker via `script_name`
 * in their wrangler.toml.
 *
 * This worker:
 * 1. Re-exports the CollabRoom DO class (so Cloudflare can instantiate it)
 * 2. Routes incoming requests to the correct DO instance
 * 3. Handles CORS for cross-origin WebSocket connections
 *
 * Request flow:
 *   Client → wss://{{APP_NAME}}-collab.workers.dev/{roomKey}/ws → this worker → CollabRoom DO
 *
 * Setup:
 *   1. Copy this directory to workers/{{APP_NAME}}-collab/
 *   2. Replace all {{PLACEHOLDER}} values in wrangler.toml
 *   3. Set BETTER_AUTH_SECRET: npx wrangler secret put BETTER_AUTH_SECRET
 *   4. Deploy: npx wrangler deploy
 */

// Re-export the Durable Object class so Cloudflare registers it.
// Resolves in place (packages/crouton-collab/worker-template/src). The deploy workflow
// deploys this template directly via `"collab": true`; a manual copy must adjust the path.
export { CollabRoom } from '../../server/durable-objects/CollabRoom'

interface Env {
  COLLAB_ROOMS: DurableObjectNamespace
  DB: D1Database
  BETTER_AUTH_SECRET?: string
}

/** Origins allowed to connect via WebSocket. Add your app's domains here. */
const ALLOWED_ORIGINS = [
  // '{{ALLOWED_ORIGIN}}',
  // e.g. 'https://my-app.pages.dev',
  // e.g. 'https://my-app.example.com',
  // e.g. 'http://localhost:3000',
]

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection',
    'Access-Control-Max-Age': '86400',
  }

  if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin
  }

  return headers
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      })
    }

    // Extract roomKey and action from the URL path
    // Expected format: /{roomKey}/{action}
    // roomKey is URL-encoded and may contain colons (e.g., "flow:abc-123")
    const pathSegments = url.pathname.split('/').filter(Boolean)

    if (pathSegments.length < 2) {
      return new Response('Bad request: expected /{roomKey}/{action}', { status: 400 })
    }

    const roomKey = decodeURIComponent(pathSegments[0])
    const action = pathSegments[1] // ws, state, or users

    // Get the DO instance for this room
    const doId = env.COLLAB_ROOMS.idFromName(roomKey)
    const stub = env.COLLAB_ROOMS.get(doId)

    // Build a new URL that the DO expects: /{action}?{original query params}
    const doUrl = new URL(request.url)
    doUrl.pathname = `/${action}`

    // Forward the request to the Durable Object
    const doRequest = new Request(doUrl.toString(), request)
    const response = await stub.fetch(doRequest)

    // For non-WebSocket responses, add CORS headers
    if (response.status !== 101) {
      const newHeaders = new Headers(response.headers)
      for (const [key, value] of Object.entries(corsHeaders(origin))) {
        newHeaders.set(key, value)
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      })
    }

    return response
  },
}
