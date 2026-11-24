import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { doctor, BUILT_IN_UI_LOCALES } from '../../lib/doctor'

// #4377 — doctor warns about configured locales the packages ship no UI texts for.
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

function makeApp(locales: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'crouton-4377-doctor-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'layers', 'site', 'i18n', 'locales'), { recursive: true })
  writeFileSync(join(dir, 'crouton.config.js'), `export default {
  locales: ${JSON.stringify(locales)},
  targets: [{ layer: 'site', collections: [] }]
}
`)
  return dir
}

describe('doctor locale check (#4377)', () => {
  it('T5a. locales en, es, it → warns es, it fall back to en; no "Locale directories present" pass', async () => {
    const { checks } = await doctor(makeApp(['en', 'es', 'it']))
    const locale = checks.filter(c => c.name === 'locales')
    expect(locale).toContainEqual({ name: 'locales', status: 'warn', message: 'es, it: no built-in UI texts — those show in en.' })
    expect(locale.some(c => c.message === 'Locale directories present')).toBe(false)
  })

  it('T5b. locales en, nl → no such warning', async () => {
    const { checks } = await doctor(makeApp(['en', 'nl']))
    const locale = checks.filter(c => c.name === 'locales')
    expect(locale.some(c => c.message.includes('no built-in UI texts'))).toBe(false)
    expect(locale.some(c => c.message === 'Locale directories present')).toBe(true)
  })

  it('T5c. BUILT_IN_UI_LOCALES matches the files in packages/crouton-i18n/locales', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'crouton-i18n', 'locales')
    const shipped = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort()
    expect([...BUILT_IN_UI_LOCALES].sort()).toEqual(shipped)
  })
})
