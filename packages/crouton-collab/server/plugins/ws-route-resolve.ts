/**
 * Make the collab WebSocket route reachable in Nitro dev/node.
 *
 * h3 resolves a WebSocket upgrade by walking the app stack in order and taking the
 * first layer that has a `__resolve__`. Lazy middleware mounted at the root
 * (e.g. the `llms.txt` handler from nuxt-seo) has one and matches every path, so it
 * "wins" resolution, carries no `__websocket__` hooks, and the upgrade is accepted
 * but `open`/`message` never fire — the socket connects and then does nothing.
 *
 * When the stock resolution finds no hooks, retry against the router alone, which
 * is where file-based `routes/**` WebSocket handlers live.
 */
export default defineNitroPlugin((nitroApp) => {
  const ws = nitroApp.h3App.websocket as {
    resolve?: (info: any) => Promise<Record<string, unknown>>
  }
  const stockResolve = ws.resolve
  if (!stockResolve) return

  ws.resolve = async (info) => {
    const hooks = await stockResolve(info)
    if (hooks && Object.keys(hooks).length > 0) return hooks

    const url = info.request?.url || info.url || '/'
    const pathname = new URL(String(url), 'http://localhost').pathname
    const resolved = await (nitroApp.router.handler as any).__resolve__?.(pathname)
    return resolved?.handler?.__websocket__ || {}
  }
})
