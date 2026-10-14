import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverCroutonPackageNames } from '../../lib/seed-app'

// #2232 — every app depends on the umbrella `@fyit/crouton`, whose dependencies list EVERY
// addon. Walking into it made each app discover the sales/bookings seed providers and write
// into tables its database doesn't have. The app's nuxt.config `extends` is what it actually
// uses, so discovery starts there and never expands the umbrella.

let root: string

function pkg(dir: string, name: string, deps: string[] = []) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    dependencies: Object.fromEntries(deps.map(d => [d, 'workspace:*'])),
  }))
}

function app(deps: string[], nuxtConfig?: string) {
  const appDir = join(root, 'app')
  pkg(appDir, 'app', deps)
  if (nuxtConfig !== undefined) writeFileSync(join(appDir, 'nuxt.config.ts'), nuxtConfig)
  return appDir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'seed-discovery-'))
  const nm = join(root, 'node_modules', '@fyit')
  pkg(join(nm, 'crouton'), '@fyit/crouton', ['@fyit/crouton-core', '@fyit/crouton-sales', '@fyit/crouton-bookings'])
  pkg(join(nm, 'crouton-core'), '@fyit/crouton-core', ['@fyit/crouton-auth'])
  pkg(join(nm, 'crouton-auth'), '@fyit/crouton-auth')
  pkg(join(nm, 'crouton-sales'), '@fyit/crouton-sales', ['@fyit/crouton-core'])
  pkg(join(nm, 'crouton-bookings'), '@fyit/crouton-bookings', ['@fyit/crouton-core'])
  pkg(join(nm, 'crouton-pages'), '@fyit/crouton-pages', ['@fyit/crouton-core'])
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('discoverCroutonPackageNames', () => {
  it('does not pull addons in through the umbrella package', () => {
    const appDir = app(['@fyit/crouton'], `export default defineNuxtConfig({
      extends: [
        '@fyit/crouton-core',
        // a comment inside the array
        '@fyit/crouton-pages',
        './layers/pages'
      ]
    })`)
    const found = discoverCroutonPackageNames(appDir)
    expect(found).toEqual(expect.arrayContaining(['@fyit/crouton-core', '@fyit/crouton-auth', '@fyit/crouton-pages']))
    expect(found).not.toContain('@fyit/crouton-sales')
    expect(found).not.toContain('@fyit/crouton-bookings')
  })

  it('keeps an addon the app extends even when it is only reachable via the umbrella', () => {
    const appDir = app(['@fyit/crouton'], `export default { extends: ['@fyit/crouton-core', '@fyit/crouton-sales'] }`)
    expect(discoverCroutonPackageNames(appDir)).toContain('@fyit/crouton-sales')
  })

  it('still follows the app\'s own direct dependencies', () => {
    const appDir = app(['@fyit/crouton', '@fyit/crouton-bookings'], `export default { extends: ['@fyit/crouton-core'] }`)
    expect(discoverCroutonPackageNames(appDir)).toContain('@fyit/crouton-bookings')
  })

  it('falls back to walking the umbrella when the app has no readable extends', () => {
    const appDir = app(['@fyit/crouton'])
    expect(discoverCroutonPackageNames(appDir)).toEqual(expect.arrayContaining(['@fyit/crouton-sales', '@fyit/crouton-bookings']))
  })
})
