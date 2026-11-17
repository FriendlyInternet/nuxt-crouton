/**
 * #3982 T9 — the `/mcp` gate (genericTools: false) blocks the generic tools'
 * routes and lets only the named pages handler through. The middleware is run
 * as h3 runs it, on real events.
 */
import { describe, it, expect } from 'vitest'
import { createApp, eventHandler, toWebHandler } from 'h3'
import gate, { isBlockedGenericMcpPath } from '../server/handlers/mcp-generic-gate'

// covers: T9
describe('isBlockedGenericMcpPath', () => {
  it('blocks /mcp, /mcp/, /mcp/deeplink, /mcp/badge.svg and other handlers', () => {
    for (const p of ['/mcp', '/mcp/', '/mcp/deeplink', '/mcp/badge.svg', '/mcp/other']) {
      expect(isBlockedGenericMcpPath(p), p).toBe(true)
    }
  })
  it('allows /mcp/pages, /mcp/pages/x and unrelated paths', () => {
    for (const p of ['/mcp/pages', '/mcp/pages/x', '/api/teams/x/mcp-tokens', '/mcpx', '/']) {
      expect(isBlockedGenericMcpPath(p), p).toBe(false)
    }
  })
})

// covers: T9
describe('mcp-generic-gate middleware', () => {
  const app = createApp()
  app.use(gate)
  app.use(eventHandler(() => 'passed'))
  const handle = toWebHandler(app)

  it('returns 404 for a blocked path', async () => {
    expect((await handle(new Request('https://velo.test/mcp'))).status).toBe(404)
    expect((await handle(new Request('https://velo.test/mcp/deeplink?ide=cursor'))).status).toBe(404)
  })
  it('passes the rest through', async () => {
    const res = await handle(new Request('https://velo.test/mcp/pages?token=x'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('passed')
    expect((await handle(new Request('https://velo.test/api/teams/x/mcp-tokens'))).status).toBe(200)
  })
})
