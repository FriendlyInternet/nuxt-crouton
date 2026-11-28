import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLayerLocales } from '../config-utils'

describe('getLayerLocales', () => {
  const dirs: string[] = []

  function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'crouton-i18n-locales-'))
    dirs.push(dir)
    const langDir = join(dir, 'layer-locales')
    mkdirSync(langDir)
    writeFileSync(join(langDir, 'en.json'), '{}')
    writeFileSync(join(langDir, 'fr.json'), '{}')
    vi.spyOn(process, 'cwd').mockReturnValue(dir)
    return langDir
  }

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('declares languages the layer has no texts file for with files: []', () => {
    const langDir = makeDir()
    writeFileSync(join(langDir, '..', 'crouton.config.js'), `export default { locales: ['en', 'fr', 'es', 'it'] }\n`)

    expect(getLayerLocales(langDir)).toEqual([
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'fr', name: 'Français', file: 'fr.json' },
      { code: 'es', name: 'Español', files: [] },
      { code: 'it', name: 'Italiano', files: [] },
    ])
  })

  it('uses the default en/nl/fr set when there is no crouton.config.js', () => {
    const langDir = makeDir()

    expect(getLayerLocales(langDir)).toEqual([
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'nl', name: 'Nederlands', files: [] },
      { code: 'fr', name: 'Français', file: 'fr.json' },
    ])
  })
})
