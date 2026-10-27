import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addToNuxtConfigExtends,
  removeFromNuxtConfigExtends,
  isInNuxtConfigExtends,
  addToConfigArray,
  setConfigOptionIfMissing,
  readNuxtConfigExtends,
} from '../../../lib/utils/update-nuxt-config.ts'

// The one nuxt.config.ts editor: every add/remove/has goes through the AST, so
// a package name in a comment never counts and user comments survive an edit.

let dir: string
let cfg: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'update-nuxt-config-'))
  cfg = join(dir, 'nuxt.config.ts')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (src: string) => writeFileSync(cfg, src)
const read = () => readFileSync(cfg, 'utf-8')
const count = (s: string, needle: string) => s.split(needle).length - 1

describe('single-line extends', () => {
  beforeEach(() => write(`export default defineNuxtConfig({ extends: ['@fyit/crouton-core'] })\n`))

  it('adds, then refuses a second add', async () => {
    expect(await addToNuxtConfigExtends(cfg, './layers/shop')).toEqual({ added: true })
    expect(await addToNuxtConfigExtends(cfg, './layers/shop')).toMatchObject({ added: false })
    expect(await readNuxtConfigExtends(cfg)).toEqual(['@fyit/crouton-core', './layers/shop'])
    expect(count(read(), './layers/shop')).toBe(1)
  })

  it('has / remove', async () => {
    expect(await isInNuxtConfigExtends(cfg, '@fyit/crouton-core')).toBe(true)
    expect(await isInNuxtConfigExtends(cfg, '@fyit/crouton-auth')).toBe(false)
    expect(await removeFromNuxtConfigExtends(cfg, 'crouton-core')).toEqual({ removed: true })
    expect(await readNuxtConfigExtends(cfg)).toEqual([])
  })
})

describe('multi-line extends', () => {
  it('appends and removes while keeping the other entries', async () => {
    write(`export default defineNuxtConfig({\n  extends: [\n    '@fyit/crouton-core',\n    './layers/a',\n  ],\n})\n`)
    await addToNuxtConfigExtends(cfg, './layers/b')
    expect(await readNuxtConfigExtends(cfg)).toEqual(['@fyit/crouton-core', './layers/a', './layers/b'])
    await removeFromNuxtConfigExtends(cfg, './layers/a')
    expect(await readNuxtConfigExtends(cfg)).toEqual(['@fyit/crouton-core', './layers/b'])
  })
})

describe('comments', () => {
  it('a name only in a comment is not extended, and gets added once', async () => {
    write(`export default defineNuxtConfig({\n  // extends @fyit/crouton-auth later\n  extends: ['@fyit/crouton-core'],\n})\n`)
    expect(await isInNuxtConfigExtends(cfg, '@fyit/crouton-auth')).toBe(false)
    expect(await addToNuxtConfigExtends(cfg, '@fyit/crouton-auth')).toEqual({ added: true })
    expect(await addToNuxtConfigExtends(cfg, '@fyit/crouton-auth')).toMatchObject({ added: false })
    expect(await readNuxtConfigExtends(cfg)).toEqual(['@fyit/crouton-core', '@fyit/crouton-auth'])
  })

  it('a commented-out entry is not an entry; the surrounding comment survives an edit', async () => {
    write(`export default defineNuxtConfig({\n  extends: [\n    // keep [core] first\n    '@fyit/crouton-core',\n    // '@fyit/crouton-maps',\n  ],\n})\n`)
    expect(await isInNuxtConfigExtends(cfg, '@fyit/crouton-maps')).toBe(false)
    await addToNuxtConfigExtends(cfg, '@fyit/crouton-maps')
    const out = read()
    expect(out).toContain('// keep [core] first')
    expect(await readNuxtConfigExtends(cfg)).toEqual(['@fyit/crouton-core', '@fyit/crouton-maps'])
  })
})

describe('local path of a package', () => {
  it('counts as the package', async () => {
    write(`export default defineNuxtConfig({ extends: ['../../packages/crouton-core'] })\n`)
    expect(await isInNuxtConfigExtends(cfg, '@fyit/crouton-core')).toBe(true)
    expect(await addToNuxtConfigExtends(cfg, '@fyit/crouton-core')).toMatchObject({ added: false })
  })
})

describe('extends inside a nested object', () => {
  it('is not the top-level extends', async () => {
    write(`export default defineNuxtConfig({\n  foo: { extends: ['@fyit/crouton-core'] },\n})\n`)
    expect(await readNuxtConfigExtends(cfg)).toEqual([])
    expect(await addToNuxtConfigExtends(cfg, '@fyit/crouton-core')).toEqual({ added: true })
    expect(await readNuxtConfigExtends(cfg)).toEqual(['@fyit/crouton-core'])
  })
})

describe('no extends', () => {
  it('creates the array', async () => {
    write(`export default defineNuxtConfig({})\n`)
    await addToNuxtConfigExtends(cfg, './layers/a')
    expect(await readNuxtConfigExtends(cfg)).toEqual(['./layers/a'])
  })

  it('reports a missing file', async () => {
    expect(await addToNuxtConfigExtends(join(dir, 'nope.ts'), 'x')).toMatchObject({ added: false })
  })
})

describe('addToConfigArray (css)', () => {
  it('fills an empty css array', async () => {
    write(`export default defineNuxtConfig({ css: [] })\n`)
    expect(await addToConfigArray(cfg, 'css', '~/assets/css/main.css')).toEqual({ added: true })
    expect(read()).toContain('~/assets/css/main.css')
  })

  it('creates css and honours the presence predicate', async () => {
    write(`export default defineNuxtConfig({})\n`)
    await addToConfigArray(cfg, 'css', '~/assets/css/main.css')
    const again = await addToConfigArray(cfg, 'css', '~/assets/css/main.css', e => e.some(x => x.includes('assets/css/main.css')))
    expect(again).toMatchObject({ added: false })
    expect(count(read(), 'main.css')).toBe(1)
  })
})

describe('setConfigOptionIfMissing', () => {
  it('sets once, never overwrites', async () => {
    write(`export default defineNuxtConfig({})\n`)
    expect(await setConfigOptionIfMissing(cfg, 'i18n', { langDir: './locales' })).toEqual({ added: true })
    expect(await setConfigOptionIfMissing(cfg, 'i18n', { langDir: './other' })).toMatchObject({ added: false })
    expect(read()).toContain('./locales')
    expect(read()).not.toContain('./other')
  })
})
