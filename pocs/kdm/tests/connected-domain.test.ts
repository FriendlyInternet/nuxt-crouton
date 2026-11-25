// T2 (#4559) — the committed config connects kasper.pmcp.dev as the kdm team's domain and
// keeps kdm.pmcp.dev as the app's own address. Reads the real wrangler.jsonc and the
// evaluated nuxt.config.ts (the resolver reads runtimeConfig.public.croutonPages).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const app = resolve(__dirname, '..')
// wrangler.jsonc: drop whole-line `//` comments, then parse (as mcp-config.test.ts does).
const jsonc = (p: string) => JSON.parse(readFileSync(resolve(app, p), 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'))

let config: any
beforeAll(async () => {
  ;(globalThis as any).defineNuxtConfig = (c: unknown) => c
  config = (await import('../nuxt.config')).default
})

describe('kdm — connected domain (#4559)', () => {
  it('staging serves both kdm.pmcp.dev and kasper.pmcp.dev as custom domains', () => {
    const routes = jsonc('wrangler.jsonc').env.staging.routes as Array<{ pattern: string, custom_domain?: boolean }>
    for (const pattern of ['kdm.pmcp.dev', 'kasper.pmcp.dev']) {
      expect(routes).toContainEqual({ pattern, custom_domain: true })
    }
  })

  it('lists only kdm.pmcp.dev as the app\'s own address, so kasper.pmcp.dev stays a team domain', () => {
    const pages = config.runtimeConfig.public.croutonPages
    expect(pages.appDomains).toEqual(['kdm.pmcp.dev'])
    expect(pages.hideLocaleInUrl).toBe(true)
  })
})
