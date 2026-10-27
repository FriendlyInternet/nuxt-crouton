import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureLayersExtended, detectRequiredDependencies } from '../../../lib/utils/module-detector.ts'
import { updateLayerRootConfig } from '../../../lib/utils/layer-config.ts'
import { setupCroutonCssSource } from '../../../lib/utils/css-setup.ts'
import { readNuxtConfigExtends } from '../../../lib/utils/update-nuxt-config.ts'

// The three former regex writers now go through update-nuxt-config.ts (#2737).

let root: string
let cwd: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'config-editors-')))
  cwd = process.cwd()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  process.chdir(cwd)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('ensureLayersExtended', () => {
  it('keeps comments, adds once, takes the app dir', async () => {
    const cfg = join(root, 'nuxt.config.ts')
    writeFileSync(cfg, `export default defineNuxtConfig({\n  extends: [\n    // keep [core] first\n    '@fyit/crouton-core',\n  ],\n})\n`)
    await ensureLayersExtended(['@fyit/crouton-maps'], root)
    await ensureLayersExtended(['@fyit/crouton-maps'], root)
    expect(await readNuxtConfigExtends(cfg)).toEqual(['@fyit/crouton-core', '@fyit/crouton-maps'])
    expect(readFileSync(cfg, 'utf-8')).toContain('// keep [core] first')
  })
})

describe('detectRequiredDependencies(appDir)', () => {
  it('reads package.json + nuxt.config from the given dir, not cwd', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@fyit/crouton-core': '1.0.0' } }))
    writeFileSync(join(root, 'nuxt.config.ts'), `export default defineNuxtConfig({ extends: ['@fyit/crouton-core'] })\n`)
    const res = await detectRequiredDependencies({}, root)
    expect(res.missing).toEqual([])
    expect(res.layers).toEqual(['@fyit/crouton-core'])
  })

  it('a package named only in a comment is not extended', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@fyit/crouton-core': '1.0.0' } }))
    writeFileSync(join(root, 'nuxt.config.ts'), `// extends: ['@fyit/crouton-core']\nexport default defineNuxtConfig({ extends: [] })\n`)
    const res = await detectRequiredDependencies({}, root)
    expect(res.missing.map(m => m.name)).toEqual(['@fyit/crouton-core'])
  })
})

describe('updateLayerRootConfig', () => {
  it('creates, then is idempotent and preserves comments', async () => {
    process.chdir(root)
    await updateLayerRootConfig('shop', 'products', true, ['en'])
    const cfg = join(root, 'layers', 'shop', 'nuxt.config.ts')
    expect(await readNuxtConfigExtends(cfg)).toEqual(['./collections/products'])
    expect(readFileSync(cfg, 'utf-8')).toContain('langDir')

    const edited = readFileSync(cfg, 'utf-8').replace('extends: [', 'extends: [\n    // keep me\n    ')
    writeFileSync(cfg, edited)
    await updateLayerRootConfig('shop', 'products', true, ['en'])
    await updateLayerRootConfig('shop', 'orders', true, ['en'])
    expect(await readNuxtConfigExtends(cfg)).toEqual(['./collections/products', './collections/orders'])
    expect(readFileSync(cfg, 'utf-8')).toContain('// keep me')
    expect(readFileSync(cfg, 'utf-8').split('langDir').length - 1).toBe(1)
  })

  it('adds extends + i18n to a bare config', async () => {
    process.chdir(root)
    const dir = join(root, 'layers', 'shop')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'nuxt.config.ts'), `export default defineNuxtConfig({})\n`)
    await updateLayerRootConfig('shop', 'products', true, ['en', 'nl'])
    const out = readFileSync(join(dir, 'nuxt.config.ts'), 'utf-8')
    expect(out).toContain('./collections/products')
    expect(out).toContain('nl.json')
  })
})

describe('setupCroutonCssSource', () => {
  it('registers the css file in an empty css array once', async () => {
    writeFileSync(join(root, 'nuxt.config.ts'), `export default defineNuxtConfig({ css: [] })\n`)
    await setupCroutonCssSource(root, { silent: true })
    const out = readFileSync(join(root, 'nuxt.config.ts'), 'utf-8')
    expect(out.split('assets/css/main.css').length - 1).toBe(1)
  })
})
