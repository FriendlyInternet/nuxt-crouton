/** node --test scripts/fetch-artifacts.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listArtifacts } from './fetch-artifacts.mjs'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const H = 3600 * 1000
const cutoff = new Date(NOW - 7 * 24 * H)
const PREFIXES = ['loop-station-trace-', 'pi-telemetry-']

// 1000 artifacts, newest first, one every 20 min (=> ~13.9 days), ≤1h jitter.
const all = Array.from({ length: 1000 }, (_, i) => {
  const jitter = (i % 7 === 0 ? 0.9 : 0) * H
  return {
    id: 10000 - i,
    name: `${['loop-station-trace-', 'pi-telemetry-', 'visual-qa-'][i % 3]}${i}`,
    expired: i % 11 === 0,
    created_at: new Date(NOW - i * 20 * 60000 + jitter).toISOString()
  }
})
const pages = Array.from({ length: 10 }, (_, p) => all.slice(p * 100, p * 100 + 100))

test('stops early and returns exactly the in-window, live, matching ids', async () => {
  const asked = []
  const got = await listArtifacts({
    fetchPage: async (n) => { asked.push(n); return pages[n - 1] ?? [] },
    cutoff, prefixes: PREFIXES
  })
  assert.ok(!asked.includes(10), 'never fetched the last page')
  const want = all.filter(a => !a.expired && PREFIXES.some(p => a.name.startsWith(p)) && Date.parse(a.created_at) >= cutoff.getTime())
  assert.deepEqual(got.map(a => a.id), want.map(a => a.id))
  assert.ok(got.length > 0)
})

test('a page cut off once is retried', async () => {
  let calls = 0
  const got = await listArtifacts({
    fetchPage: async (n) => {
      if (n === 2 && ++calls === 1) throw new Error('unexpected end of JSON input')
      return pages[n - 1] ?? []
    },
    cutoff, prefixes: PREFIXES
  })
  assert.equal(calls, 2)
  assert.ok(got.length > 100)
})

test('a page that keeps failing rejects with where it got to', async () => {
  await assert.rejects(
    listArtifacts({
      fetchPage: async (n) => { if (n === 3) throw new Error('boom'); return pages[n - 1] },
      cutoff, prefixes: PREFIXES
    }),
    /listed 2 pages \/ 200 artifacts, failed at page 3/
  )
})

test('zero matches is [] not an error', async () => {
  const got = await listArtifacts({ fetchPage: async () => [], cutoff, prefixes: PREFIXES })
  assert.deepEqual(got, [])
})

test('edge: a jittered artifact just older than the cutoff is excluded, one just inside is kept', async () => {
  const mk = (id, ms) => ({ id, name: 'pi-telemetry-x', expired: false, created_at: new Date(cutoff.getTime() + ms).toISOString() })
  const page = [mk(1, 60000), mk(2, 1000), mk(3, -1000), mk(4, -H)]
  const got = await listArtifacts({ fetchPage: async n => (n === 1 ? page : []), cutoff, prefixes: PREFIXES })
  assert.deepEqual(got.map(a => a.id), [1, 2])
})
