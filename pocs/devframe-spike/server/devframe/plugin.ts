// Registered ONLY by modules/crouton-devframe.ts via the `nitro:config` hook
// (dev only). It must never live in server/plugins/ — Nitro scans that dir in
// production builds too and would ship a no-login WebSocket.
import { initDevframe } from 'devframe/initiate'
import { useRuntimeConfig } from 'nitropack/runtime'
import { createCroutonDevframe } from './definition'
import { state } from './state'

export default (nitroApp: { hooks: { hook: (name: string, fn: () => void) => void } }) => {
  const cfg = useRuntimeConfig() as { croutonDevframe?: { distDir?: string } }
  const distDir = cfg.croutonDevframe?.distDir
  const fetchJson = ((path: string, opts?: { query?: Record<string, unknown> }) =>
    (globalThis as any).$fetch(path, { query: opts?.query })) as any

  const instance = initDevframe(
    createCroutonDevframe({ fetchJson, clientAssets: distDir }),
    {
      base: '/__crouton_df/',
      auth: false, // single-user localhost; whole module is dev-only
      ws: { sidecar: true },
      mcp: { path: 'mcp' },
      ...(distDir ? { distDir } : {})
    }
  )
  state.instance = instance
  nitroApp.hooks.hook('close', () => { void instance.close() })
}
