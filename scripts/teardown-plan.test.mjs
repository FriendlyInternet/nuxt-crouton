// layer: stack
/**
 * #2863 — teardown decision contract (epic #2858 cases 1-5, 9, 11).
 *
 *   node --test scripts/teardown-plan.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTeardown, branchMatchesApp } from './teardown-plan.mjs'

const pocConfig = `{
  // jsonc comment
  "name": "foo",
  "d1_databases": [{ "binding": "DB", "database_name": "foo-preview-db", "database_id": "x" }],
  "kv_namespaces": [{ "binding": "KV", "id": "kv-foo" }],
}`

test('1: a fully deleted pocs/foo is torn down', () => {
  const plan = planTeardown({
    deletedPaths: ['pocs/foo/package.json', 'pocs/foo/app/app.vue'],
    remainingPaths: ['pocs/bar/package.json'],
    configsByApp: { foo: pocConfig },
  })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].app, 'foo')
  assert.equal(plan[0].kind, 'poc')
  assert.equal(plan[0].worker, 'foo')
})

test('2: names come from the last config, not the convention', () => {
  const [p] = planTeardown({
    deletedPaths: ['pocs/foo/wrangler.jsonc'],
    configsByApp: { foo: pocConfig },
  })
  assert.equal(p.d1, 'foo-preview-db')
  assert.equal(p.kvId, 'kv-foo')
  assert.equal(p.notes.some(n => n.includes('naming convention')), false)
})

test('3: a deleted apps/bar is staging only, with a note about production', () => {
  const plan = planTeardown({
    deletedPaths: ['apps/bar/nuxt.config.ts'],
    configsByApp: {
      bar: { name: 'bar', env: { staging: { d1_databases: [{ database_name: 'bar-s-db' }], kv_namespaces: [{ id: 'kv-s' }] } } },
    },
  })
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].envs, ['staging'])
  assert.equal(plan[0].worker, 'bar-staging')
  assert.equal(plan[0].d1, 'bar-s-db')
  assert.equal(plan[0].kvId, 'kv-s')
  assert.ok(plan[0].notes.some(n => n.includes('teardown-app.yml')))
})

test('4: deleting some files while the folder stays tears nothing down', () => {
  const plan = planTeardown({
    deletedPaths: ['pocs/foo/old.ts'],
    remainingPaths: ['pocs/foo/package.json'],
    configsByApp: { foo: pocConfig },
  })
  assert.deepEqual(plan, [])
})

test('5: moving pocs/foo to apps/foo (promotion) tears nothing down', () => {
  const plan = planTeardown({
    deletedPaths: ['pocs/foo/package.json'],
    remainingPaths: ['apps/foo/package.json'],
    configsByApp: { foo: pocConfig },
  })
  assert.deepEqual(plan, [])
})

test('9: a similarly named app is never planned', () => {
  const plan = planTeardown({
    deletedPaths: ['pocs/crouton-builder-demo/package.json'],
    remainingPaths: ['pocs/crouton-builder/package.json'],
    configsByApp: { 'crouton-builder-demo': { name: 'crouton-builder-demo' } },
  })
  assert.deepEqual(plan.map(p => p.app), ['crouton-builder-demo'])
  assert.equal(plan[0].d1, 'crouton-builder-demo-db')
  assert.ok(plan.every(p => !/^crouton-builder(-staging|-db|-kv)?$/.test(p.worker)))
})

test('11: branches match the exact app name followed by nothing, - or /', () => {
  assert.equal(branchMatchesApp('crouton-builder-demo', 'crouton-builder-demo'), true)
  assert.equal(branchMatchesApp('poc/crouton-builder-demo/x', 'crouton-builder-demo'), true)
  assert.equal(branchMatchesApp('work-12-crouton-builder-demo-fix', 'crouton-builder-demo'), true)
  // per the agreed rule `-` may follow, so this direction matches; the demo-removal direction below must not
  assert.equal(branchMatchesApp('crouton-builder-demo', 'crouton-builder'), true)
  assert.equal(branchMatchesApp('crouton-builder', 'crouton-builder-demo'), false)
  assert.equal(branchMatchesApp('crouton-builders', 'crouton-builder'), false)
})
