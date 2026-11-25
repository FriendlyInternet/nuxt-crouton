// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyPublicRouteOptions } from '../app/utils/public-routes'
import { buildPagePath } from '../app/utils/page-path'

// #4191 case 4 — with the setting off, every real consumer of crouton-pages
// keeps exactly today's public routes and links. Consumers are found by
// scanning, not listed, so a new app is checked automatically.

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')
const DEFAULT_LOCALES = ['en', 'nl', 'fr'] // mirrors getCroutonLocales()' fallback

interface Consumer { name: string, dir: string, config: string }

function findConsumers(): Consumer[] {
  const found: Consumer[] = []
  for (const group of ['apps', 'pocs']) {
    const groupDir = join(repoRoot, group)
    if (!existsSync(groupDir)) continue
    for (const name of readdirSync(groupDir)) {
      const cfgPath = join(groupDir, name, 'nuxt.config.ts')
      if (!existsSync(cfgPath)) continue
      const config = readFileSync(cfgPath, 'utf8')
      if (config.includes('\'@fyit/crouton-pages\'')) found.push({ name, dir: join(groupDir, name), config })
    }
  }
  return found
}

async function localesFor(dir: string): Promise<string[]> {
  for (const ext of ['.js', '.mjs', '.cjs', '.ts']) {
    const p = join(dir, `crouton.config${ext}`)
    if (!existsSync(p)) continue
    const mod = await import(/* @vite-ignore */ pathToFileURL(p).href) as any
    const cfg = mod?.default ?? mod
    const locales = cfg?.locales as Array<string | { code: string }> | undefined
    if (!locales?.length) return DEFAULT_LOCALES
    return locales.map(l => (typeof l === 'string' ? l : l.code))
  }
  return DEFAULT_LOCALES
}

function nuxtPages() {
  return [
    { name: 'team-locale-slug', path: '/:team()/:locale()/:slug(.*)*' },
    { name: 'team-slug', path: '/:team()/:slug(.*)*' },
    { name: 'auth-login', path: '/auth/login' },
  ]
}

// Frozen copy of the pages:extend hook's output before #4191.
function todaysHookOutput(routingMode: string) {
  const pages = nuxtPages()
  if (routingMode === 'locale' || routingMode === 'custom') {
    return pages.filter(p => p.name !== 'team-locale-slug' && p.name !== 'team-slug')
  }
  return pages
}

// covers: T12 (#4526)
// An app that switches hideLocaleInUrl on (pocs/kdm, #4526) has opted into the
// new behaviour, so the "setting off changes nothing" check does not apply to it.
const consumers = findConsumers().filter(c => !/hideLocaleInUrl:\s*true/.test(c.config))

describe('crouton-pages consumers — setting off changes nothing (T4)', () => {
  it('finds at least the five known consumers', () => {
    const names = consumers.map(c => c.name)
    for (const expected of ['velo', 'kassa', 'gallery', 'alexdeforce', 'sintlukas']) {
      expect(names).toContain(expected)
    }
  })

  it('reads each app\'s real locales (not the fallback)', async () => {
    const dirOf = (n: string) => consumers.find(c => c.name === n)!.dir
    expect(await localesFor(dirOf('velo'))).toEqual(['fr', 'nl', 'en'])
    expect(await localesFor(dirOf('kassa'))).toEqual(['nl'])
  })

  it.each(consumers.map(c => [c.name, c] as const))('%s', async (_name, consumer) => {
    expect(consumer.config).not.toMatch(/hideLocaleInUrl/)
    const routingMode = consumer.config.match(/routingMode:\s*['"](\w+)['"]/)?.[1] ?? 'team'
    const locales = await localesFor(consumer.dir)

    const pages = nuxtPages()
    applyPublicRouteOptions(pages, { routingMode, hideLocaleInUrl: false, locales })
    expect(pages).toEqual(todaysHookOutput(routingMode))

    if (routingMode === 'team') {
      const locale = locales[0]!
      const link = (slugPath: string) => buildPagePath({ hideTeamInUrl: false, team: 'test1', locale, slugPath })
      expect(link('about')).toBe(`/test1/${locale}/about`)
      expect(link('events/fair')).toBe(`/test1/${locale}/events/fair`)
      expect(link('')).toBe(`/test1/${locale}`)
    }
  })
})
