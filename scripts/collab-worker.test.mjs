import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCollabConfig, collabWorkerName, deriveCollabSecret, extractWorkerUrl } from './lib/collab-worker.mjs'

test('worker name per target', () => {
  assert.equal(collabWorkerName({ app: 'velo', environment: 'production' }), 'velo-collab')
  assert.equal(collabWorkerName({ app: 'velo', environment: 'staging', pr: '42' }), 'velo-pr42-collab')
  assert.equal(collabWorkerName({ app: 'velo', environment: 'staging' }), 'velo-collab-staging')
  assert.equal(collabWorkerName({ app: 'velo', environment: 'production', pr: '42' }), 'velo-collab')
})

test('generated config is id-less and binds the room DO + D1', () => {
  const c = buildCollabConfig({ name: 'w', db: 'w-db', main: '/x/index.ts' })
  assert.equal(c.name, 'w')
  assert.deepEqual(c.d1_databases, [{ binding: 'DB', database_name: 'w-db' }])
  assert.equal(c.d1_databases[0].database_id, undefined)
  assert.deepEqual(c.durable_objects.bindings, [{ name: 'COLLAB_ROOMS', class_name: 'CollabRoom' }])
  assert.deepEqual(c.migrations[0].new_classes, ['CollabRoom'])
})

test('extracts the workers.dev URL', () => {
  const out = 'Uploaded w\nDeployed w triggers\n  https://w.team.workers.dev\nCurrent Version ID: 1'
  assert.equal(extractWorkerUrl(out, 'w'), 'https://w.team.workers.dev')
})

test('fails loudly when no URL is printed', () => {
  assert.throws(() => extractWorkerUrl('Deployed, no url', 'w'), /no workers\.dev URL/)
})

test('derived secret is deterministic and scoped', () => {
  const a = deriveCollabSecret({ seed: 's', app: 'velo', scope: 'staging' })
  assert.equal(a, deriveCollabSecret({ seed: 's', app: 'velo', scope: 'staging' }))
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, deriveCollabSecret({ seed: 's', app: 'velo', scope: 'pr42' }))
  assert.notEqual(a, deriveCollabSecret({ seed: 's', app: 'other', scope: 'staging' }))
  assert.throws(() => deriveCollabSecret({ seed: '', app: 'velo', scope: 'staging' }))
})
