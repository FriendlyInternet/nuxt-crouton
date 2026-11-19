/**
 * `/mcp` gate (#3982) — registered by module.ts ONLY when
 * `croutonMcpToolkit.genericTools === false`. It lives in server/handlers/ (not
 * server/middleware/) so it is never auto-registered.
 *
 * Turning the toolkit on for the pages tools must not also open the generic
 * collection CRUD + token tools at `/mcp`: this answers 404 for `/mcp`, `/mcp/`,
 * `/mcp/deeplink`, `/mcp/badge.svg` and any `/mcp/<name>` other than `/mcp/pages`.
 */
import { createError, defineEventHandler, getRequestURL } from 'h3'

const ALLOWED_HANDLERS = new Set(['pages'])

export function isBlockedGenericMcpPath(pathname: string): boolean {
  if (pathname !== '/mcp' && !pathname.startsWith('/mcp/')) return false
  const first = pathname.slice('/mcp/'.length).split('/')[0] ?? ''
  return !ALLOWED_HANDLERS.has(first)
}

export default defineEventHandler((event) => {
  if (isBlockedGenericMcpPath(getRequestURL(event).pathname)) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
})
