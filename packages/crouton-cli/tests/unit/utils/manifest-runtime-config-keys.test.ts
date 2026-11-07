import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { discoverManifests } from '../../../lib/utils/manifest-loader.ts'

// #3398: a package with `configuration` must declare the runtimeConfig key it
// reads, and its own code must mention that key — otherwise the generator
// writes settings the package silently ignores.

const packagesDir = resolve(__dirname, '../../../..')

function sources(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sources(full))
    else if (/\.(ts|vue)$/.test(name)) out.push(readFileSync(full, 'utf8'))
  }
  return out
}

describe('manifest runtimeConfigKey', async () => {
  const manifests = (await discoverManifests() as any[])
    .filter(m => m.configuration && Object.keys(m.configuration).length > 0)

  it('has packages with configuration to check', () => {
    expect(manifests.length).toBeGreaterThan(0)
  })

  for (const m of manifests) {
    it(`${m.id} declares a key its own code reads`, () => {
      expect(m.runtimeConfigKey, `${m.id} must declare runtimeConfigKey`).toBeTruthy()
      const pkg = join(packagesDir, m.id)
      const code = [
        ...sources(join(pkg, 'app')),
        ...sources(join(pkg, 'server')),
        existsSync(join(pkg, 'nuxt.config.ts')) ? readFileSync(join(pkg, 'nuxt.config.ts'), 'utf8') : '',
      ].join('\n')
      expect(code, `${m.id} code never mentions ${m.runtimeConfigKey}`).toMatch(new RegExp(`\\b${m.runtimeConfigKey}\\b`))
    })
  }
})
