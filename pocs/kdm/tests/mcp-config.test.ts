// T6 (#4493) — kdm's committed config lets Claude sign in at <origin>/mcp and use the page
// tools, the way velo does. Reads the real nuxt.config.ts (evaluated, not grepped),
// deploy.config.json, wrangler.jsonc, package.json and the committed migrations.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const app = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(app, p), 'utf8')
const json = (p: string) => JSON.parse(read(p))
// wrangler.jsonc: drop whole-line `//` comments, then parse.
const jsonc = (p: string) => JSON.parse(read(p).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'))

let config: any
beforeAll(async () => {
  ;(globalThis as any).defineNuxtConfig = (c: unknown) => c
  config = (await import('../nuxt.config')).default
})

describe('kdm — Claude page tools (#4493)', () => {
  it('names one team: reviewTeam === defaultTeamSlug === kdm', () => {
    expect(json('deploy.config.json').reviewTeam).toBe('kdm')
    expect(config.croutonAuth.teams.defaultTeamSlug).toBe('kdm')
  })

  it('extends the collab and mcp-toolkit layers, and depends on them', () => {
    expect(config.extends).toEqual(expect.arrayContaining(['@fyit/crouton-collab', '@fyit/crouton-mcp-toolkit']))
    const deps = json('package.json').dependencies
    expect(deps['@fyit/crouton-collab']).toBeDefined()
    expect(deps['@fyit/crouton-mcp-toolkit']).toBeDefined()
  })

  it('serves only the page tools, never the generic CRUD + token tools', () => {
    expect(config.croutonMcpToolkit).toEqual({ enabled: true, genericTools: false, pages: true })
  })

  it('lets Claude sign in at /mcp (mcpOAuth on)', () => {
    expect(config.croutonAuth.mcpOAuth).toBe(true)
  })

  it('deploys the live-sync worker and lists every layer for the deploy', () => {
    const deploy = json('deploy.config.json')
    expect(deploy.collab).toBe(true)
    const layers = deploy.layerPackages.split(/\s+/)
    for (const l of ['@fyit/crouton-auth', '@fyit/crouton-collab', '@fyit/crouton-mcp-toolkit']) expect(layers).toContain(l)
  })

  it('sets global_fetch_strictly_public on the worker', () => {
    expect(jsonc('wrangler.jsonc').compatibility_flags).toContain('global_fetch_strictly_public')
  })

  it('smokes the sign-in surface on every deploy', () => {
    const reads = json('deploy.config.json').smoke.reads as Array<{ path: string, expectStatus?: number }>
    const byPath = Object.fromEntries(reads.map(r => [r.path, r]))
    expect(byPath['/mcp']?.expectStatus).toBe(401)
    expect(byPath['/mcp/pages']?.expectStatus).toBe(404)
    expect(byPath['/.well-known/oauth-authorization-server']).toBeDefined()
    expect(byPath['/.well-known/oauth-protected-resource']).toBeDefined()
    expect(byPath['/api/auth/oauth2/get-consents']).toBeDefined()
    expect(reads.some(r => r.path.startsWith('/api/collab/token'))).toBe(true)
  })

  it('a committed migration creates the sign-in tables, and the journal lists every migration', () => {
    const dir = 'server/db/migrations/sqlite'
    const files = readdirSync(resolve(app, dir)).filter(f => f.endsWith('.sql')).sort()
    const sql = files.map(f => read(`${dir}/${f}`)).join('\n')
    for (const t of ['jwks', 'oauthAccessToken', 'oauthConsent', 'oauthClient', 'oauthRefreshToken']) {
      expect(sql).toContain(`CREATE TABLE \`${t}\``)
    }
    const tags = json(`${dir}/meta/_journal.json`).entries.map((e: { tag: string }) => `${e.tag}.sql`).sort()
    expect(tags).toEqual(files)
  })
})
