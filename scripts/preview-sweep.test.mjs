import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewPr, planSweep, runSweep } from './preview-sweep.mjs'

test('previewPr reads the PR number from preview names only', () => {
  assert.equal(previewPr('velo-pr4137'), 4137)
  assert.equal(previewPr('velo-pr4137-collab'), 4137)
  assert.equal(previewPr('velo-pr4137-db'), 4137)
  assert.equal(previewPr('velo-pr4137-collab-db'), 4137)
  assert.equal(previewPr('crouton-builder-pr2300-kv'), 2300)
  // never a real app's resource
  for (const n of ['velo', 'velo-staging', 'velo-db', 'velo-staging-db', 'kassa-kv', 'pr12', 'velo-pr12x', 'velo-pr-db', 'velo-pr12-db-backup', 'express-prod-db'])
    assert.equal(previewPr(n), null, n)
})

const found = {
  workers: ['velo', 'velo-staging', 'velo-pr10', 'velo-pr11', 'velo-pr11-collab'],
  d1: ['velo-db', 'velo-pr10-db', 'velo-pr11-db', 'velo-pr11-collab-db'],
  kv: [{ title: 'velo-kv', id: 'a' }, { title: 'velo-pr10-kv', id: 'b' }, { title: 'velo-pr11-kv', id: 'c' }],
}

test('planSweep deletes previews of PRs that are no longer open, and nothing else', () => {
  const plan = planSweep({ ...found, openPrs: [10] })
  assert.deepEqual(plan.workers, ['velo-pr11', 'velo-pr11-collab'])
  assert.deepEqual(plan.d1, ['velo-pr11-db', 'velo-pr11-collab-db'])
  assert.deepEqual(plan.kv, [{ title: 'velo-pr11-kv', id: 'c' }])
})

// PRs #3177, #3610, #3613, #3767: closed while in conflict, so GitHub never started their own
// "on PR close" run. Any later PR close must clean them up — the sweep does not look at which PR closed.
test('planSweep picks up a PR whose own close event never fired', () => {
  const plan = planSweep({ workers: ['kassa-pr3767'], d1: ['kassa-pr3767-db'], kv: [], openPrs: [4212] })
  assert.deepEqual(plan.workers, ['kassa-pr3767'])
  assert.deepEqual(plan.d1, ['kassa-pr3767-db'])
})

const world = ({ open = [10], failDelete = [], stays = [] } = {}) => {
  let state = structuredClone(found)
  const deleted = []
  const del = kind => async (x) => {
    const name = x.title ?? x
    if (failDelete.includes(name)) throw new Error('boom')
    deleted.push(name)
    if (stays.includes(name)) return
    state[kind] = state[kind].filter(y => (y.title ?? y) !== name)
  }
  const io = {
    listOpenPrs: async () => open,
    listWorkers: async () => state.workers,
    listD1: async () => state.d1,
    listKv: async () => state.kv,
    deleteWorker: del('workers'), deleteD1: del('d1'), deleteKv: del('kv'),
  }
  const log = []
  return { io, deleted, log, logger: { info: m => log.push(m), error: m => log.push(`ERR ${m}`) } }
}

test('runSweep deletes the plan and reports ok when nothing is left', async () => {
  const w = world()
  const r = await runSweep(w.io, w.logger)
  assert.equal(r.ok, true)
  assert.deepEqual(w.deleted.sort(), ['velo-pr11', 'velo-pr11-collab', 'velo-pr11-collab-db', 'velo-pr11-db', 'velo-pr11-kv'])
  assert.deepEqual(r.left, [])
})

// The old step printed "✓ d1 <name>" from `… | tail -1 && echo ✓`: tail always succeeds, so a
// failed delete read as done. The sweep looks again instead of trusting any exit code.
test('runSweep is not ok and names what is still there when a delete fails or does nothing', async () => {
  const w = world({ failDelete: ['velo-pr11-db'], stays: ['velo-pr11-kv'] })
  const r = await runSweep(w.io, w.logger)
  assert.equal(r.ok, false)
  assert.deepEqual(r.left.sort(), ['velo-pr11-db', 'velo-pr11-kv'])
  assert.ok(w.log.some(m => m.startsWith('ERR') && m.includes('velo-pr11-db')))
})

test('runSweep deletes nothing when the open PR list cannot be read', async () => {
  const w = world()
  w.io.listOpenPrs = async () => { throw new Error('rate limited') }
  await assert.rejects(runSweep(w.io, w.logger), /rate limited/)
  assert.deepEqual(w.deleted, [])
})

test('runSweep with nothing to delete says so and is ok', async () => {
  const w = world({ open: [10, 11] })
  const r = await runSweep(w.io, w.logger)
  assert.equal(r.ok, true)
  assert.deepEqual(w.deleted, [])
  assert.ok(w.log.some(m => /nothing to delete/.test(m)))
})
