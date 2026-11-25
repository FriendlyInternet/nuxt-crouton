import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

// Screens and per-screen composables must listen to `crouton:mutation` through
// `useMutationListener`, which removes the listener when the screen goes away.
// A bare `nuxtApp.hook('crouton:mutation', …)` lives as long as the app (#4491).
const pkgs = resolve(import.meta.dirname, '../..')
const dirs = [
  'crouton-core/app/components',
  'crouton-core/app/composables',
  'crouton-pages/app/composables',
  'crouton-pages/app/components',
  'crouton-pages/app/layouts'
]
// useCroutonStatus registers once per runtime behind `hookRegistered`.
const allowed = new Set(['useMutationListener.ts', 'useCroutonStatus.ts'])
const pattern = /\.hook\(\s*['"`]crouton:mutation['"`]/

const isSource = (path: string) => /\.(ts|vue)$/.test(path) && !/(^|\/)(__tests__|node_modules)\//.test(path)

function listSources(dir: string): string[] {
  const abs = join(pkgs, dir)
  if (!existsSync(abs)) return []
  return (readdirSync(abs, { recursive: true }) as string[]).filter(isSource).map(rel => join(abs, rel))
}

describe('crouton:mutation listeners are scoped', () => {
  it('no screen or composable registers a bare crouton:mutation hook', () => {
    const files = dirs.flatMap(listSources)
    expect(files.length).toBeGreaterThan(0)

    const offenders = files
      .filter(file => !allowed.has(basename(file)))
      .filter(file => pattern.test(readFileSync(file, 'utf8')))
      .map(file => relative(pkgs, file))
    expect(offenders).toEqual([])
  })
})
