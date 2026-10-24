import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveExtendedPackages } from '../../../lib/utils/extended-packages.ts'

// The ONE answer to "which crouton packages does this app use" (#2286, owner
// decision 2026-10-16): the app's `extends` graph, walked transitively, so
// `@fyit/crouton-core` brings auth/admin/i18n with it. `crouton.config.js
// features` is no longer a switch — a package is on when the app extends it.

let root: string
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'extended-pkgs-'))) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

function mklayer(dir: string, opts: { extends?: string[]; pkgName?: string } = {}): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'nuxt.config.ts'), `export default defineNuxtConfig({ extends: ${JSON.stringify(opts.extends ?? [])} })\n`)
  if (opts.pkgName) writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: opts.pkgName }))
  return dir
}

describe('resolveExtendedPackages', () => {
  it('returns the ids of @fyit/crouton-* specs, resolvable or not', () => {
    mklayer(root, { extends: ['@fyit/crouton-core', '@fyit/crouton-bookings'] })
    expect(resolveExtendedPackages(root)).toEqual(['crouton-core', 'crouton-bookings'])
  })

  it('collapses a package subpath (a theme) to its package id', () => {
    mklayer(root, { extends: ['@fyit/crouton-themes/ko'] })
    expect(resolveExtendedPackages(root)).toEqual(['crouton-themes'])
  })

  it('follows a path extends to a package by its package.json name, then that package\'s own extends', () => {
    mklayer(join(root, 'vendor', 'pages'), { pkgName: '@fyit/crouton-pages', extends: ['@fyit/crouton-editor'] })
    mklayer(root, { extends: ['./vendor/pages'] })
    expect(resolveExtendedPackages(root)).toEqual(['crouton-pages', 'crouton-editor'])
  })

  it('walks through an app layer that is not a package', () => {
    mklayer(join(root, 'layers', 'shop'), { extends: ['@fyit/crouton-maps'] })
    mklayer(root, { extends: ['./layers/shop'] })
    expect(resolveExtendedPackages(root)).toEqual(['crouton-maps'])
  })

  it('ignores specs that are not crouton packages and dedups repeats', () => {
    mklayer(root, { extends: ['@nuxt/ui-pro', '@fyit/crouton-core', '@fyit/crouton-core'] })
    expect(resolveExtendedPackages(root)).toEqual(['crouton-core'])
  })

  it('is empty without a nuxt.config or an extends list', () => {
    expect(resolveExtendedPackages(root)).toEqual([])
    mklayer(root)
    expect(resolveExtendedPackages(root)).toEqual([])
  })

  it('pulls in the packages crouton-core bundles for a real fixture', () => {
    const fixture = resolve(__dirname, '../../../../../fixtures/with-bookings')
    const ids = resolveExtendedPackages(fixture)
    for (const id of ['crouton-core', 'crouton-auth', 'crouton-admin', 'crouton-i18n', 'crouton-bookings']) {
      expect(ids).toContain(id)
    }
    expect(ids).not.toContain('crouton-sales')
  })
})
