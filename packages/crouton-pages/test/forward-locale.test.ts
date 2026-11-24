// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { resolveForwardLocale } from '../app/utils/forward-locale'

// #4292 — the no-language forward must pick the same language on the server and
// in the browser, and app code must never read the server-only croutonI18n key.

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')

describe('resolveForwardLocale — one-language app (T1 / L1)', () => {
  const config = { configLocales: ['en'], configDefault: 'en', pagesDefault: 'en' }

  it('resolves en with live i18n values (full load)', () => {
    expect(resolveForwardLocale({ ...config, live: 'en', liveLocales: ['en'], liveDefault: 'en' })).toBe('en')
  })

  it('resolves en without live i18n values (useI18n unavailable)', () => {
    expect(resolveForwardLocale(config)).toBe('en')
  })

  it('a one-language nl app resolves nl, never a hardcoded en', () => {
    expect(resolveForwardLocale({ configLocales: [{ code: 'nl' }], pagesDefault: 'en' })).toBe('nl')
  })
})

describe('resolveForwardLocale — three-language app, default nl (T2 / L2)', () => {
  const config = { configLocales: ['en', 'nl', 'fr'], configDefault: 'nl', pagesDefault: 'en' }

  it('resolves nl with live values', () => {
    expect(resolveForwardLocale({ ...config, live: 'nl', liveLocales: ['en', 'nl', 'fr'], liveDefault: 'nl' })).toBe('nl')
  })

  it('resolves nl when i18n is unavailable (fell to en on main in the browser)', () => {
    expect(resolveForwardLocale(config)).toBe('nl')
  })

  it('drops a stale live cookie from another app and resolves nl', () => {
    expect(resolveForwardLocale({ ...config, live: 'de', liveLocales: ['en', 'nl', 'fr'], liveDefault: 'nl' })).toBe('nl')
  })

  it('falls back to en with no input at all', () => {
    expect(resolveForwardLocale({})).toBe('en')
  })
})

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (/\.(vue|ts)$/.test(name)) out.push(p)
  }
}

describe('no private croutonI18n read in app code (T3 / L3)', () => {
  it('no file under packages/*/app reads runtimeConfig.croutonI18n', () => {
    const files: string[] = []
    const pkgs = join(repoRoot, 'packages')
    for (const pkg of readdirSync(pkgs)) {
      const app = join(pkgs, pkg, 'app')
      try {
        if (statSync(app).isDirectory()) walk(app, files)
      } catch { /* package has no app/ */ }
    }
    expect(files.length).toBeGreaterThan(0)
    const re = /runtimeConfig\.croutonI18n|useRuntimeConfig\(\)\.croutonI18n/
    const hits = files.filter(f => re.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })

  it('the forward page resolves through resolveForwardLocale fed by public i18n config', () => {
    const page = readFileSync(join(repoRoot, 'packages/crouton-pages/app/pages/[team]/[...slug].vue'), 'utf8')
    expect(page).toMatch(/resolveForwardLocale\(\{/)
    expect(page).toMatch(/runtimeConfig\.public\?\.i18n/)
  })
})
