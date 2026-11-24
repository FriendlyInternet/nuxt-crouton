/**
 * `/mcp` gate (#3982, #4097) — registered by module.ts ONLY when
 * `croutonMcpToolkit.genericTools === false`. It lives in server/handlers/ (not
 * server/middleware/) so it is never auto-registered.
 *
 * Turning the toolkit on for the page tools must not also open the generic
 * collection CRUD + token tools: this answers 404 for everything under `/mcp/`
 * (`/mcp/`, `/mcp/deeplink`, `/mcp/badge.svg`, `/mcp/pages`, any `/mcp/<name>`).
 * `/mcp` itself passes only when it serves the page tools (`pagesAtRoot`: pages
 * + crouton-auth's sign-in both on) — never on the sign-in flag alone.
 */
import { createError, defineEventHandler, getRequestURL } from 'h3'

export function isBlockedGenericMcpPath(pathname: string, pagesAtRoot = false): boolean {
  if (pathname === '/mcp') return !pagesAtRoot
  return pathname.startsWith('/mcp/')
}

export default defineEventHandler((event) => {
  const runtime = useRuntimeConfig().croutonMcpToolkit as { pagesAtRoot?: boolean } | undefined
  if (isBlockedGenericMcpPath(getRequestURL(event).pathname, runtime?.pagesAtRoot === true)) {
    throw createError({ status: 404, statusText: 'Not Found' })
  }
})
