import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveLocale } from '../../lib/seed-app.ts'

const dirs: string[] = []
const appDir = (config?: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-locale-'))
  dirs.push(dir)
  if (config) writeFileSync(join(dir, 'crouton.config.mjs'), config)
  return dir
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('resolveLocale', () => {
  it("uses the app's configured defaultLocale", async () => {
    expect(await resolveLocale(undefined, appDir("export default { 'defaultLocale': 'fr' }"))).toBe('fr')
  })
  it('falls back to en without a config', async () => {
    expect(await resolveLocale(undefined, appDir())).toBe('en')
  })
  it('--locale wins over the config', async () => {
    expect(await resolveLocale('nl', appDir("export default { defaultLocale: 'fr' }"))).toBe('nl')
  })
})
