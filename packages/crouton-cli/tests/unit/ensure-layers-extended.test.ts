import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureLayersExtended } from '../../lib/utils/module-detector'

// #2731: nuxt.config.ts must only be rewritten when the extends list really changes.
describe('ensureLayersExtended', () => {
  let dir: string
  let cwd: string

  beforeEach(() => {
    cwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), 'layers-'))
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(cwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not touch the file when every layer is already extended', async () => {
    const original = `export default defineNuxtConfig({ extends: ['@fyit/crouton'] })\n`
    writeFileSync('nuxt.config.ts', original)
    const before = statSync('nuxt.config.ts').mtimeMs
    await new Promise(r => setTimeout(r, 20))
    await ensureLayersExtended(['@fyit/crouton'])
    expect(readFileSync('nuxt.config.ts', 'utf-8')).toBe(original)
    expect(statSync('nuxt.config.ts').mtimeMs).toBe(before)
  })

  it('adds a missing layer', async () => {
    writeFileSync('nuxt.config.ts', `export default defineNuxtConfig({ extends: ['@fyit/crouton'] })\n`)
    await ensureLayersExtended(['@fyit/crouton-auth'])
    expect(readFileSync('nuxt.config.ts', 'utf-8')).toContain('@fyit/crouton-auth')
  })
})
