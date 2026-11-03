import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCollection, verifyCollection, main } from './verify-content-db.mjs'

function harness({ ready = () => 1, fetchImpl }) {
  let t = 0
  const sqls = []
  const deps = {
    now: () => t,
    sleep: async (ms) => { t += ms },
    exec: async (sql) => {
      sqls.push(sql)
      if (sql.startsWith('DELETE')) return '[]'
      return JSON.stringify([{ results: [{ id: 'checksum_docs', ready: ready(sqls) }, { id: 'checksum_landing', ready: ready(sqls) }] }])
    },
    fetch: async (...a) => fetchImpl(a, () => t, (ms) => { t += ms }),
    log: () => {},
    deadlineMs: 60000,
    gapMs: 5000,
  }
  return { deps, sqls }
}

const ok = { status: 200 }
const abort = () => { throw new DOMException('aborted', 'TimeoutError') }
const deletes = sqls => sqls.filter(s => s.startsWith('DELETE'))

test('(a) slow 200 (arrives after 20 s) with ready=1 is unhealthy', async () => {
  const { deps } = harness({ fetchImpl: (_a, _t, adv) => { adv(20000); return ok } })
  const r = await checkCollection('docs', deps)
  assert.equal(r.status, 200)
  assert.equal(r.healthy, false)
})

test('(a2) aborted query with ready=1 is unhealthy', async () => {
  const { deps } = harness({ fetchImpl: (_a, _t, adv) => { adv(15000); return abort() } })
  assert.equal((await checkCollection('docs', deps)).healthy, false)
})

test('(b) ready=0 with fast 200 is unhealthy', async () => {
  const { deps } = harness({ ready: () => 0, fetchImpl: () => ok })
  assert.equal((await checkCollection('docs', deps)).healthy, false)
})

test('(c) unhealthy -> one scoped DELETE -> later healthy', async () => {
  const { deps, sqls } = harness({
    ready: s => (s.some(x => x.startsWith('DELETE')) ? 1 : 0),
    fetchImpl: () => ok,
  })
  assert.equal(await verifyCollection('docs', deps), true)
  const d = deletes(sqls)
  assert.equal(d.length, 1)
  assert.match(d[0], /checksum_docs/)
  assert.doesNotMatch(d[0], /landing/)
})

test('(d) never healthy after repair -> failure, exit 1', async () => {
  const { deps, sqls } = harness({ ready: () => 0, fetchImpl: () => ok })
  assert.equal(await verifyCollection('docs', deps), false)
  assert.equal(deletes(sqls).length, 1)
  assert.equal(await main(harness({ ready: () => 0, fetchImpl: () => ok }).deps), 1)
})

test('(e) healthy -> no DELETE, exit 0', async () => {
  const { deps, sqls } = harness({ fetchImpl: () => ok })
  assert.equal(await main(deps), 0)
  assert.equal(deletes(sqls).length, 0)
})

test('(f) first re-check timing out is retried until deadline', async () => {
  let calls = 0
  const { deps, sqls } = harness({
    fetchImpl: (_a, _t, adv) => {
      calls++
      if (calls <= 3) { adv(15000); return abort() }
      return ok
    },
  })
  assert.equal(await verifyCollection('docs', deps), true)
  assert.equal(deletes(sqls).length, 1)
  assert.ok(calls >= 4)
})
