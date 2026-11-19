// @vitest-environment node
/**
 * T1 (#4096) — `buildPlugins` adds the MCP sign-in plugins only with the flag on.
 *
 * Goes through the exported `createAuth()` (the same call the app's server
 * makes) and reads the plugin list and the provider's own options off the
 * real better-auth instance — not a hand-built options object.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { ORIGIN, freshDb, instance, pluginIds } from './mcp-oauth-harness'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

type ProviderOptions = {
  resource?: string
  loginPage?: string
  consentPage?: string
  scopes?: string[]
  allowDynamicClientRegistration?: boolean
  allowUnauthenticatedClientRegistration?: boolean
}

let sqlite: Database.Database

describe('T1 — buildPlugins and the mcpOAuth flag (#4096)', () => {
  beforeEach(async () => { sqlite = await freshDb() })
  afterEach(async () => {
    // better-auth runs its plugins' async init after createAuth() returns.
    await new Promise(resolve => setTimeout(resolve, 50))
    sqlite.close()
  })

  it('flag off: no jwt, no OAuth provider, no cleanup hook', () => {
    const ids = pluginIds(instance(sqlite, false))
    expect(ids).not.toContain('jwt')
    expect(ids).not.toContain('oauth-provider')
    expect(ids).not.toContain('crouton-mcp-client-cleanup')
  })

  it('flag on: jwt + exactly one OAuth provider (mcp), no cimd, no second oauthProvider', () => {
    const ids = pluginIds(instance(sqlite, true))
    expect(ids).toContain('jwt')
    // mcp() IS the provider: a separate oauthProvider() would show a second id.
    expect(ids.filter(id => id === 'oauth-provider')).toHaveLength(1)
    expect(ids.some(id => /cimd/i.test(id))).toBe(false)
    expect(ids).toContain('crouton-mcp-client-cleanup')
  })

  it('flag on: scopes are offline_access + pages, DCR on and open, login/consent pages, resource <base>/mcp', () => {
    const auth = instance(sqlite, true)
    const provider = (auth.options.plugins as { id: string, options?: ProviderOptions }[])
      .find(p => p.id === 'oauth-provider')!
    const opts = provider.options!
    expect(opts.scopes).toEqual(['offline_access', 'pages'])
    expect(opts.allowDynamicClientRegistration).toBe(true)
    expect(opts.allowUnauthenticatedClientRegistration).toBe(true)
    expect(opts.loginPage).toBe('/auth/login')
    expect(opts.consentPage).toBe('/auth/consent')
    // mcp() maps its `resource` onto the provider's resource list.
    expect(JSON.stringify(opts)).toContain(`${ORIGIN}/mcp`)
  })
})
