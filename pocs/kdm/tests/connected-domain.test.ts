// T1 (#4569) — the committed config keeps staging on kdm.pmcp.dev only, the app's own address;
// no client domain is connected on staging. Reads the real wrangler.jsonc and the
// evaluated nuxt.config.ts (the resolver reads runtimeConfig.public.croutonPages).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const app = resolve(__dirname, '..')
// wrangler.jsonc: drop whole-line `//` comments, then parse (as mcp-config.test.ts does).
const jsonc = (p: string) => JSON.parse(readFileSync(resolve(app, p), 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'))

let config: any
beforeAll(async () => {
  ;(globalThis as any).defineNuxtConfig = (c: unknown) => c
  // Node loads nuxt.config.ts itself, so vite never needs ../.nuxt/tsconfig.json (absent before `nuxt prepare`).
  config = createRequire(import.meta.url)('../nuxt.config.ts').default
})

describe('kdm — staging address (#4569)', () => {
  // covers: T1
  it('staging routes list only kdm.pmcp.dev', () => {
    const routes = jsonc('wrangler.jsonc').env.staging.routes as Array<{ pattern: string, custom_domain?: boolean }>
    expect(routes).toEqual([{ pattern: 'kdm.pmcp.dev', custom_domain: true }])
  })

  it('lists only kdm.pmcp.dev as the app\'s own address, with plain URLs', () => {
    const pages = config.runtimeConfig.public.croutonPages
    expect(pages.appDomains).toEqual(['kdm.pmcp.dev'])
    expect(pages.hideLocaleInUrl).toBe(true)
  })
})
