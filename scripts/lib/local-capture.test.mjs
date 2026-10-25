import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveSurfaces, parseSurfaceLines, resolveTargets, toMarkers } from './local-capture.mjs'

test('parseSurfaceLines: app + several paths, {team} filled', () => {
  assert.deepEqual(parseSurfaceLines('x\nSurface: kassa /admin/{team}/a, /admin/{team}/b\ny'), [
    { app: 'kassa', path: '/admin/test1/a' },
    { app: 'kassa', path: '/admin/test1/b' }
  ])
})

test('parseSurfaceLines: ignores missing label and non-path values', () => {
  assert.deepEqual(parseSurfaceLines('no surface here\nSurface: kassa nowhere'), [])
})

test('deriveSurfaces: static page route for a single app', () => {
  assert.deepEqual(deriveSurfaces(['apps/kassa/app/pages/shop/index.vue']), [{ app: 'kassa', path: '/shop' }])
})

test('deriveSurfaces: refuses dynamic routes, packages-only and multi-app', () => {
  assert.deepEqual(deriveSurfaces(['apps/kassa/app/pages/[id].vue']), [])
  assert.deepEqual(deriveSurfaces(['packages/x/app/components/A.vue']), [])
  assert.deepEqual(deriveSurfaces(['apps/a/app/pages/x.vue', 'apps/b/app/pages/y.vue']), [])
})

test('resolveTargets: ticket line wins, then derive, then none', () => {
  assert.equal(resolveTargets({ issueBody: 'Surface: a /x', changedFiles: [] }).source, 'named on the ticket')
  assert.equal(resolveTargets({ issueBody: '', changedFiles: ['apps/a/app/pages/y.vue'] }).surfaces.length, 1)
  assert.deepEqual(resolveTargets({ issueBody: '', changedFiles: [] }), { surfaces: [], source: 'no surface named' })
})

test('toMarkers: one marker per surface, unique names', () => {
  assert.equal(
    toMarkers([{ app: 'a', path: '/x' }, { app: 'a', path: '/y' }]),
    '<!-- review-surface: a /x name:s1 -->\n<!-- review-surface: a /y name:s2 -->'
  )
})
