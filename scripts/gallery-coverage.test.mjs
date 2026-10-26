/**
 * #2462 contract — every shared package with UI pieces is in the gallery.
 * The last test runs on the REAL repo: adding a package with components and not adding it to
 * pocs/gallery fails CI here.
 *
 *   node --test scripts/gallery-coverage.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingFromGallery, readRepo } from './gallery-coverage.mjs'

const pkg = (name, hasPieces, deps = []) => ({ name, hasPieces, deps })

test('a package with pieces the gallery does not depend on is missing', () => {
  assert.deepEqual(missingFromGallery({
    packages: [pkg('@fyit/a', true), pkg('@fyit/b', true)],
    galleryDeps: ['@fyit/a'],
  }), ['@fyit/b'])
})

test('reached through another package counts (core brings auth)', () => {
  assert.deepEqual(missingFromGallery({
    packages: [pkg('@fyit/core', true, ['@fyit/auth']), pkg('@fyit/auth', true, ['@fyit/i18n']), pkg('@fyit/i18n', true)],
    galleryDeps: ['@fyit/core'],
  }), [])
})

test('a package without pieces is not required', () => {
  assert.deepEqual(missingFromGallery({ packages: [pkg('@fyit/cli', false)], galleryDeps: [] }), [])
})

test('cycles terminate', () => {
  assert.deepEqual(missingFromGallery({
    packages: [pkg('@fyit/a', true, ['@fyit/b']), pkg('@fyit/b', true, ['@fyit/a'])],
    galleryDeps: ['@fyit/a'],
  }), [])
})

test('the gallery covers every shared package that has UI pieces (live repo)', () => {
  const missing = missingFromGallery(readRepo(new URL('..', import.meta.url).pathname))
  assert.deepEqual(missing, [], `Not in the gallery: ${missing.join(', ')} — add each to pocs/gallery (package.json dependencies, nuxt.config.ts extends, deploy.config.json layerPackages).`)
})
