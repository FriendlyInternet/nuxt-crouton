// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// #4198 — Nuxt 4.6 cannot map an inline `defineRouteRules` on a catch-all page
// (`[...slug]`) to a Nitro route rule. It prints NUXT_B4016 and silently drops
// the rule, so the page looks cached in code while nothing is cached at all.
// Every page is scanned, so a new catch-all page is checked automatically.

const pagesDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../app/pages')

function walkVue(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkVue(full))
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

describe('inline route rules on catch-all pages', () => {
  const catchAllPages = walkVue(pagesDir).filter(f => relative(pagesDir, f).includes('[...'))

  it('finds at least one catch-all page to check', () => {
    expect(catchAllPages.length).toBeGreaterThan(0)
  })

  // covers: T1
  it('no catch-all page calls defineRouteRules (Nuxt 4.6 drops it with NUXT_B4016)', () => {
    const offenders = catchAllPages
      .filter(f => readFileSync(f, 'utf8').includes('defineRouteRules('))
      .map(f => relative(pagesDir, f))
    expect(
      offenders,
      `NUXT_B4016: Nuxt cannot apply inline route rules on catch-all pages, so they are silently dropped. Remove defineRouteRules from: ${offenders.join(', ')}`
    ).toEqual([])
  })
})
