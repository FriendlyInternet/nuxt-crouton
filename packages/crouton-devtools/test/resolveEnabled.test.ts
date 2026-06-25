import { describe, it, expect } from 'vitest'
import { folderDefault, resolveDevtools } from '../src/resolve-enabled'

describe('folderDefault (#811)', () => {
  it('is on under pocs/ and fixtures/', () => {
    expect(folderDefault('/repo/pocs/blog')).toBe(true)
    expect(folderDefault('/repo/fixtures/minimal')).toBe(true)
  })

  it('is off under apps/ and anything else', () => {
    expect(folderDefault('/repo/apps/velo')).toBe(false)
    expect(folderDefault('/repo/sandboxes/foo')).toBe(false)
    expect(folderDefault('/somewhere/else')).toBe(false)
  })

  it('normalises windows separators', () => {
    expect(folderDefault('C:\\repo\\pocs\\blog')).toBe(true)
    expect(folderDefault('C:\\repo\\apps\\velo')).toBe(false)
  })

  it('matches the folder as a path segment, not a substring', () => {
    // a folder literally named "apps-archive" must not read as apps/
    expect(folderDefault('/repo/pocs-archive/x')).toBe(false)
    expect(folderDefault('/repo/my-pocs')).toBe(false)
  })
})

describe('resolveDevtools (#811)', () => {
  const build = { dev: false }

  it('POC build with no override → menu on + annotate machinery on', () => {
    const r = resolveDevtools({ rootDir: '/repo/pocs/blog', ...build })
    expect(r.menuEnabled).toBe(true)
    expect(r.annotateMachineryOn).toBe(true)
  })

  it('app build with no override → menu off + annotate machinery off', () => {
    const r = resolveDevtools({ rootDir: '/repo/apps/velo', ...build })
    expect(r.menuEnabled).toBe(false)
    expect(r.annotateMachineryOn).toBe(false)
  })

  it('explicit override forces on in an app', () => {
    const r = resolveDevtools({ rootDir: '/repo/apps/velo', ...build, devtools: 'true' })
    expect(r.menuEnabled).toBe(true)
    expect(r.annotateMachineryOn).toBe(true)
  })

  it('explicit override forces off in a POC (wins over folder default)', () => {
    const r = resolveDevtools({ rootDir: '/repo/pocs/blog', ...build, devtools: 'false' })
    expect(r.menuEnabled).toBe(false)
    expect(r.annotateMachineryOn).toBe(false)
  })

  it('local dev is always on, even in an app', () => {
    const r = resolveDevtools({ rootDir: '/repo/apps/velo', dev: true })
    expect(r.menuEnabled).toBe(true)
    // …but annotate's build-time machinery never installs in dev
    expect(r.annotateMachineryOn).toBe(false)
  })

  it('explicit off wins even in local dev', () => {
    const r = resolveDevtools({ rootDir: '/repo/apps/velo', dev: true, devtools: 'false' })
    expect(r.menuEnabled).toBe(false)
  })

  it('deprecated _REVIEW alias turns the menu on for a build (with a flagged warning)', () => {
    const r = resolveDevtools({ rootDir: '/repo/apps/velo', ...build, review: 'true' })
    expect(r.menuEnabled).toBe(true)
    expect(r.annotateMachineryOn).toBe(true)
    expect(r.deprecatedAliases).toEqual(['NUXT_PUBLIC_CROUTON_REVIEW'])
  })

  it('deprecated _ERUDA alias turns the menu on for a build', () => {
    const r = resolveDevtools({ rootDir: '/repo/apps/velo', ...build, eruda: 'true' })
    expect(r.menuEnabled).toBe(true)
    expect(r.deprecatedAliases).toEqual(['NUXT_PUBLIC_CROUTON_ERUDA'])
  })

  it('aliases are on-only — review=false does not force off', () => {
    const r = resolveDevtools({ rootDir: '/repo/pocs/blog', ...build, review: 'false' })
    expect(r.menuEnabled).toBe(true) // folder default still wins
    expect(r.deprecatedAliases).toEqual([])
  })

  it('explicit override wins over a deprecated alias', () => {
    const r = resolveDevtools({ rootDir: '/repo/apps/velo', ...build, devtools: 'false', review: 'true' })
    expect(r.menuEnabled).toBe(false)
  })

  it('reports no deprecated aliases when none are set', () => {
    const r = resolveDevtools({ rootDir: '/repo/pocs/blog', ...build })
    expect(r.deprecatedAliases).toEqual([])
  })
})
