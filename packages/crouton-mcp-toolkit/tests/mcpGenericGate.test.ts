/**
 * #3982 / #4097 — the `/mcp` gate (genericTools: false) blocks the generic tools'
 * routes; `/mcp` itself passes only when it serves the page tools (`pagesAtRoot`).
 * The middleware is run as h3 runs it, on real events, reading the real
 * runtime-config key module.ts sets.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, eventHandler, toWebHandler } from 'h3'
import gate, { isBlockedGenericMcpPath } from '../server/handlers/mcp-generic-gate'

let runtime: Record<string, unknown> = {}
beforeEach(() => {
  runtime = {}
  vi.stubGlobal('useRuntimeConfig', () => runtime)
})
afterEach(() => vi.unstubAllGlobals())

describe('isBlockedGenericMcpPath', () => {
  // covers: T6
  it('pagesAtRoot: only exactly /mcp passes; /mcp/, /mcp/pages and the rest are blocked', () => {
    expect(isBlockedGenericMcpPath('/mcp', true)).toBe(false)
    for (const p of ['/mcp/', '/mcp/pages', '/mcp/pages/x', '/mcp/x', '/mcp/deeplink', '/mcp/badge.svg']) {
      expect(isBlockedGenericMcpPath(p, true), p).toBe(true)
    }
  })

  // covers: T10
  it('without pagesAtRoot everything under /mcp is blocked, /mcp included', () => {
    for (const p of ['/mcp', '/mcp/', '/mcp/pages', '/mcp/deeplink', '/mcp/badge.svg', '/mcp/other']) {
      expect(isBlockedGenericMcpPath(p), p).toBe(true)
      expect(isBlockedGenericMcpPath(p, false), p).toBe(true)
    }
  })

  // covers: T6
  it('unrelated paths always pass', () => {
    for (const p of ['/api/teams/x/mcp-tokens', '/mcpx', '/', '/.well-known/oauth-protected-resource/mcp']) {
      expect(isBlockedGenericMcpPath(p, true), p).toBe(false)
      expect(isBlockedGenericMcpPath(p, false), p).toBe(false)
    }
  })
})

describe('mcp-generic-gate middleware', () => {
  const app = createApp()
  app.use(gate)
  app.use(eventHandler(() => 'passed'))
  const handle = toWebHandler(app)

  // covers: T6
  it('pagesAtRoot on: /mcp passes, /mcp/pages, /mcp/ and /mcp/x answer 404', async () => {
    runtime = { croutonMcpToolkit: { pagesAtRoot: true } }
    const res = await handle(new Request('https://velo.test/mcp', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('passed')
    for (const p of ['/mcp/pages', '/mcp/', '/mcp/x']) {
      expect((await handle(new Request(`https://velo.test${p}`))).status, p).toBe(404)
    }
  })

  // covers: T10
  it('pagesAtRoot off (velo with the sign-in flag off): /mcp and /mcp/pages answer 404', async () => {
    runtime = { croutonMcpToolkit: { pagesAtRoot: false } }
    expect((await handle(new Request('https://velo.test/mcp'))).status).toBe(404)
    expect((await handle(new Request('https://velo.test/mcp/pages?token=x'))).status).toBe(404)
    runtime = {}
    expect((await handle(new Request('https://velo.test/mcp'))).status).toBe(404)
  })

  // covers: T10
  it('passes the rest through', async () => {
    expect((await handle(new Request('https://velo.test/api/teams/x/mcp-tokens'))).status).toBe(200)
  })
})
