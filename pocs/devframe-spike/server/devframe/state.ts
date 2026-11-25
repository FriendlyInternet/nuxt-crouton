import type { DevframeInstance } from 'devframe/initiate'

// Module-level singleton shared by the Nitro plugin and the request handler
// (same bundle). The instance is built once, never per request.
export const state: { instance?: DevframeInstance } = {}
