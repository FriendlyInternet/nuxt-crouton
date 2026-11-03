import { defineDevframe, defineRpcFunction } from 'devframe'
import * as v from 'valibot'

export type FetchJson = (path: string, opts?: { query?: Record<string, unknown> }) => Promise<unknown>

const BASE = '/__nuxt_crouton_devtools/api'

export const OperationsArgs = v.object({
  collection: v.optional(v.string()),
  operation: v.optional(v.string()),
  status: v.optional(v.picklist(['success', 'error'])),
  since: v.optional(v.union([v.string(), v.number()]))
})

/** Drop unset keys so the query carries exactly what the caller gave. */
function compact(obj: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined))
}

export function createCroutonDevframe(opts: { fetchJson: FetchJson, clientAssets?: string }) {
  const { fetchJson, clientAssets } = opts
  return defineDevframe({
    id: 'crouton-df',
    name: 'Crouton (Devframe)',
    version: '0.0.0',
    packageName: 'devframe-spike',
    homepage: 'https://github.com/FriendlyInternet/nuxt-crouton',
    description: 'Spike: Crouton collections + operations over Devframe RPC and MCP',
    importMetaUrl: import.meta.url,
    ...(clientAssets ? { clientAssets } : {}),
    setup(ctx) {
      // Names are registered as-is (no namespace added); MCP maps ':' to '_'.
      ctx.rpc.register(defineRpcFunction({
        name: 'crouton-df:list-collections',
        type: 'query',
        args: [],
        returns: v.any(),
        agent: { description: 'List the Crouton collections registered in this app.' },
        handler: () => fetchJson(`${BASE}/collections`)
      }))
      ctx.rpc.register(defineRpcFunction({
        name: 'crouton-df:list-operations',
        type: 'query',
        args: [OperationsArgs],
        returns: v.any(),
        handler: (args) => fetchJson(`${BASE}/operations`, { query: compact(args ?? {}) })
      }))
    }
  })
}
