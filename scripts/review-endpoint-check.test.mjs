// #4062 — the feedback-endpoint check retries a 404 / no answer before failing.
//   node --test scripts/review-endpoint-check.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEndpoint, formatResult } from './review-endpoint-check.mjs'

/** A fetch stub answering each call from `answers` (a status, or 'throw'); records requests. */
function stub(answers) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const a = answers[calls.length - 1]
    if (a === 'throw') throw new Error('fetch failed')
    return { status: a }
  }
  return { fetchImpl, calls }
}
function sleeper() {
  const waits = []
  return { sleep: async (ms) => { waits.push(ms) }, waits }
}

// covers: T1
test('E1 — 404 then 405 passes on the second try after one 5 s wait', async () => {
  const { fetchImpl } = stub([404, 405])
  const { sleep, waits } = sleeper()
  const r = await checkEndpoint('https://x.dev', { fetchImpl, sleep })
  assert.equal(r.ok, true)
  assert.equal(r.code, 405)
  assert.equal(r.tries, 2)
  assert.deepEqual(waits, [5000])
  assert.match(formatResult('https://x.dev', r).join('\n'), /✓ feedback endpoint live \(POST \/api\/_feedback → 405\) after 2 tries/)
})

// covers: T2
test('E2 — 404 on all five tries fails with the original errors and the statuses', async () => {
  const { fetchImpl, calls } = stub([404, 404, 404, 404, 404])
  const { sleep, waits } = sleeper()
  const r = await checkEndpoint('https://x.dev', { fetchImpl, sleep })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 5)
  assert.deepEqual(waits, [5000, 10000, 15000, 20000])
  const out = formatResult('https://x.dev', r)
  assert.deepEqual(out, [
    '::error::No feedback endpoint at https://x.dev (POST /api/_feedback → 404).',
    `::error::The app does not install the overlay — add '@fyit/crouton-devtools'`,
    '::error::to its nuxt.config modules + dependencies (#2073).',
    '::error::tries: 404, 404, 404, 404, 404',
  ])
})

// covers: T3
test('E3 — a thrown fetch counts as no answer (0) and is retried', async () => {
  const { fetchImpl } = stub(['throw', 200])
  const { sleep } = sleeper()
  const r = await checkEndpoint('https://x.dev', { fetchImpl, sleep })
  assert.equal(r.ok, true)
  assert.deepEqual(r.statuses, [0, 200])
})

// covers: T4
test('E4 — a first-try 401 passes at once with no wait', async () => {
  const { fetchImpl } = stub([401])
  const { sleep, waits } = sleeper()
  const r = await checkEndpoint('https://x.dev', { fetchImpl, sleep })
  assert.equal(r.ok, true)
  assert.equal(r.tries, 1)
  assert.deepEqual(waits, [])
  assert.deepEqual(formatResult('https://x.dev', r), ['✓ feedback endpoint live (POST /api/_feedback → 401)'])
})

// covers: T5
test('E5 — POSTs {} as JSON to <base>/api/_feedback, trimming a trailing slash', async () => {
  const { fetchImpl, calls } = stub([401])
  await checkEndpoint('https://x.dev/', { fetchImpl, sleep: async () => {} })
  assert.equal(calls[0].url, 'https://x.dev/api/_feedback')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(calls[0].init.body, '{}')
})

// covers: T6
test('E7 — a request that hangs until its timeout aborts counts as 0 and is retried', async () => {
  let n = 0
  const fetchImpl = (url, init) => {
    n++
    if (n === 1) {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    }
    return Promise.resolve({ status: 200 })
  }
  // AbortSignal.timeout's timer is unref'd — hold the event loop open until the abort fires.
  const keepAlive = setTimeout(() => {}, 5000)
  const r = await checkEndpoint('https://x.dev', { fetchImpl, sleep: async () => {}, timeoutMs: 20 })
  clearTimeout(keepAlive)
  assert.equal(r.ok, true)
  assert.deepEqual(r.statuses, [0, 200])
})
