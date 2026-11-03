type WsHooks = Record<string, unknown>

/**
 * Pick the WebSocket hooks for an upgrade request: the stock h3 result when it has
 * any, otherwise whatever the router alone resolves for the request path.
 */
export async function resolveWsHooks(
  info: any,
  stockResolve: (info: any) => Promise<WsHooks>,
  routerResolve?: (pathname: string) => Promise<any> | any
): Promise<WsHooks> {
  const hooks = await stockResolve(info)
  if (hooks && Object.keys(hooks).length > 0) return hooks

  const url = info.request?.url || info.url || '/'
  let pathname = '/'
  try {
    pathname = new URL(String(url), 'http://localhost').pathname
  } catch {
    // unparseable URL — fall back to the root path
  }
  const resolved = await routerResolve?.(pathname)
  return resolved?.handler?.__websocket__ || {}
}
