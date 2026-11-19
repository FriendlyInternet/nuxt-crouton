// @vitest-environment node
/**
 * #4175 — every package's top-level pages, plus one the app adds, reach the
 * server list. Loads velo with Nuxt's own loader (prepare mode, build dir in a
 * tmp dir) and evaluates the `#crouton-pages/app-segments` Nitro virtual module
 * the crouton-pages inline module registers.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNuxt, loadNuxt } from 'nuxt/kit'

const veloDir = fileURLToPath(new URL('../../../apps/velo', import.meta.url))

describe('#crouton-pages/app-segments (real page tree)', () => {
  it('lists every package top-level page and an app-added page', async () => {
    const buildDir = mkdtempSync(join(tmpdir(), 'crouton-pages-segments-'))
    const nuxt = await loadNuxt({
      cwd: veloDir,
      overrides: {
        _prepare: true,
        buildDir,
        modules: [
          (_options: unknown, n: { hook: (name: string, fn: (pages: Array<{ path: string, name?: string }>) => void) => void }) => {
            n.hook('pages:extend', (pages) => {
              pages.push({ path: '/my-app-page', name: 'my-app-page', file: fileURLToPath(new URL('./stubs/app-segments.ts', import.meta.url)) } as { path: string, name: string })
            })
          }
        ]
      } as Record<string, unknown>
    })
    try {
      await buildNuxt(nuxt)
      const getContents = nuxt.options.nitro.virtual?.['#crouton-pages/app-segments'] as () => string | Promise<string>
      const source = await getContents()
      const list = JSON.parse(source.replace(/^export const appPageSegments = /, '')) as string[]
      for (const seg of ['account', 'onboarding', 'admin', 'auth', 'super-admin', 'my-app-page']) {
        expect(list, seg).toContain(seg)
      }
      expect(list.some(s => s.includes(':'))).toBe(false)
    }
    finally {
      await nuxt.close()
      rmSync(buildDir, { recursive: true, force: true })
    }
  }, 120_000)
})
