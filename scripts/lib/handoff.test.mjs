import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyHandoffError, RUN_NAME, handoffRunTitle, labelHandoffDone, handoffMarker, parseHandoff } from './handoff.mjs'
import { handoffExec, handoffGuard } from '../handoff-exec.mjs'
import { sweep } from '../handoff-sweep.mjs'

const ghErr = (stderr) => Object.assign(new Error('Command failed: gh'), { stderr })
const LIMIT = () => ghErr('gh: API rate limit exceeded for installation ID 1 (HTTP 403)')
const S500 = () => ghErr('could not create workflow dispatch event: HTTP 500 (…/dispatches)')
const T0 = Date.parse('2026-11-04T10:00:00Z')

// Route table for the fake `gh`: first matching pattern answers.
function routes(w, args, j) {
  const post = args.includes('POST')
  const body = () => args.at(-1)
  return [
    [/^workflow run/, () => { w.dispatched = (w.dispatched || 0) + 1; return '' }],
    [/rate_limit/, () => '5000'],
    [/issues\/(\d+)\/comments/, (m) => {
      if (!post) return j(w.comments[m[1]] || [])
      ;(w.comments[m[1]] ||= []).push({ id: w.nextId++, body: body().slice(5) }); return ''
    }],
    [/issues\/comments\/(\d+)/, (m) => { for (const l of Object.values(w.comments)) for (const c of l) if (c.id == m[1]) c.body = body().slice(5); return '' }],
    [/issues\/(\d+)\/labels\/(.+)$/, (m) => { if (args.includes('DELETE')) w.labels.delete(`${m[1]}:${decodeURIComponent(m[2])}`); return '' }],
    [/issues\/(\d+)\/labels/, (m) => {
      const l = body().slice(9); w.labels.add(`${m[1]}:${l}`); w.adds = (w.adds || 0) + (l === 'handoff:pending' ? 0 : 1)
      if (l !== 'handoff:pending') w.events.push({ event: 'labeled', created_at: new Date(w.t).toISOString(), label: { name: l }, actor: { login: 'nuxt-harness[bot]' } })
      return ''
    }],
    [/issues\/\d+\/events/, () => j(w.events)],
    [/actions\/workflows/, () => j(w.runs)],
    [/issues\?labels=/, () => Object.entries(w.comments).filter(([n]) => w.labels.has(`${n}:handoff:pending`)).map(([n]) => n).join('\n')],
    [/pipeline-plan/, () => '777'],
    [/no-go/, () => '888'],
  ]
}

// Fake GitHub: comments per issue, labels, events, runs; `failOn(args)` may return an Error to throw.
function world({ failOn = () => null, runs = [], events = [], comments = {} } = {}) {
  const w = { calls: [], posted: [], labels: new Set(), runs, events, comments, nextId: 1000, t: T0, failOn }
  const j = (a) => a.map((x) => JSON.stringify(x)).join('\n')
  w.deps = {
    repo: 'o/r', tokens: ['app', 'fb'], log: () => {}, now: () => w.t,
    gh: async (args, { token } = {}) => {
      const s = args.join(' ')
      w.calls.push(s)
      const f = w.failOn(s, token); if (f) throw f
      for (const [re, fn] of routes(w, args, j)) { const m = re.exec(s); if (m) return fn(m) }
      throw new Error('unexpected gh ' + s)
    },
  }
  return w
}
const dispatchStep = { kind: 'dispatch', issue: 5, workflow: 'work-issue-pidev.yml', inputs: { issue: 5, mode: 'build', plan: 9 } }

test('classify: limit and 5xx defer, everything else throws', () => {
  assert.deepEqual(classifyHandoffError(LIMIT()).reason, 'limit')
  assert.equal(classifyHandoffError(S500()).reason, 'server')
  assert.equal(classifyHandoffError(ghErr('gh: Bad gateway (HTTP 502)')).action, 'defer')
  assert.equal(classifyHandoffError({ status: 502 }).reason, 'server')
  assert.equal(classifyHandoffError({ status: 403, message: 'API rate limit exceeded' }).reason, 'limit')
  for (const e of [{ status: 404 }, { status: 422 }, { status: 401 }, { status: 403, message: 'nope', response: { headers: { 'x-ratelimit-remaining': '10' } } }, new Error('ECONNRESET'), ghErr('gh: Not Found (HTTP 404)')])
    assert.equal(classifyHandoffError(e).action, 'throw')
})

test('1: limit on the READ before the dispatch → one marker + label, exit clean, nothing dispatched', async () => {
  const w = world({ failOn: (s) => (/pipeline-plan/.test(s) ? LIMIT() : null) })
  const r = await handoffExec({ kind: 'plan-build', issue: 5 }, w.deps)
  assert.equal(r.status, 'deferred'); assert.equal(r.reason, 'limit')
  assert.equal(w.comments[5].length, 1); assert.ok(w.labels.has('5:handoff:pending')); assert.equal(w.dispatched, undefined)
})
test('1b: HTTP 500 on the dispatch (#3341) → deferred as server', async () => {
  const w = world({ failOn: (s) => (s.startsWith('workflow run') ? S500() : null) })
  const r = await handoffExec(dispatchStep, w.deps)
  assert.equal(r.reason, 'server'); assert.match(w.comments[5][0].body, /server error/)
  const g = await handoffGuard({ kind: 'label', issue: 6, label: 'work-this' }, async () => { throw Object.assign(new Error('x'), { status: 502 }) }, world().deps)
  assert.equal(g.deferred, true)
})
test('2: limit on a label add defers; a second deferral updates the same marker', async () => {
  const w = world({ failOn: (s) => (/issues\/5\/labels/.test(s) && /work-this/.test(s) ? LIMIT() : null) })
  const step = { kind: 'label', issue: 5, label: 'work-this' }
  await handoffExec(step, w.deps); await handoffExec(step, w.deps)
  assert.equal(w.comments[5].length, 1); assert.equal(parseHandoff(w.comments[5][0].body).attempts, 1)
})
test('3a/3b/3c: replay never doubles a dispatch', async () => {
  // b: no run → dispatched once, marker closed, second sweep does nothing
  const w = world({ failOn: (s) => (s.startsWith('workflow run') && !w.ok ? S500() : null) })
  await handoffExec(dispatchStep, w.deps); w.ok = true; w.t += 3600e3
  await sweep(w.deps); assert.equal(w.dispatched, 1); assert.match(w.comments[5][0].body, /handoff-done/)
  await sweep(w.deps); assert.equal(w.dispatched, 1)
  // a/c: the 500 hid a write that happened → the run exists, replay does not dispatch
  const w2 = world({ failOn: (s) => (s.startsWith('workflow run') ? S500() : null) })
  await handoffExec(dispatchStep, w2.deps)
  w2.runs.push({ display_title: handoffRunTitle(dispatchStep.workflow, dispatchStep.inputs), created_at: new Date(T0 + 1000).toISOString() })
  w2.failOn = () => null; await sweep(w2.deps)
  assert.equal(w2.dispatched, undefined); assert.match(w2.comments[5][0].body, /handoff-done/)
})
test('3d/3e: label kind with an old breadcrumb and no event → remove-then-add once; never an hourly loop', async () => {
  const w = world({ failOn: (s) => (/issues\/5\/labels/.test(s) && /delegate-pi/.test(s) && !w.ok ? S500() : null),
    events: [{ event: 'labeled', created_at: new Date(T0 - 5e6).toISOString(), label: { name: 'delegate-pi' }, actor: { login: 'nuxt-harness[bot]' } }] })
  w.comments[5] = [{ id: 1, body: '<!-- work-run:42 -->' }]
  await handoffExec({ kind: 'label', issue: 5, label: 'delegate-pi' }, w.deps); w.ok = true; w.t += 3600e3
  await sweep(w.deps); await sweep(w.deps); await sweep(w.deps)
  assert.equal(w.adds, 1)
})
test('3f: a landed add (event by the bot after since) is not redone; foreign events do not count', async () => {
  const since = new Date(T0).toISOString()
  const ev = (o) => ({ event: 'labeled', created_at: new Date(T0 + 1000).toISOString(), label: { name: 'work-this' }, actor: { login: 'nuxt-harness[bot]' }, ...o })
  assert.equal(labelHandoffDone([ev({})], { label: 'work-this', since }), true)
  assert.equal(labelHandoffDone([ev({ created_at: new Date(T0 - 1e3).toISOString() })], { label: 'work-this', since }), false)
  assert.equal(labelHandoffDone([ev({ actor: { login: 'human' } })], { label: 'work-this', since }), false)
  assert.equal(labelHandoffDone([ev({ label: { name: 'other' } })], { label: 'work-this', since }), false)
  const w = world({ failOn: (s) => (/issues\/5\/labels/.test(s) && /work-this/.test(s) && !w.ok ? S500() : null) })
  await handoffExec({ kind: 'label', issue: 5, label: 'work-this' }, w.deps)
  w.events.push(ev({ created_at: new Date(T0 + 500).toISOString() })); w.ok = true; w.t += 3600e3
  await sweep(w.deps); assert.equal(w.adds, 0); assert.match(w.comments[5][0].body, /handoff-done/)
})
test('4: other errors rethrow with no marker, even after earlier output that mentions limits', async () => {
  for (const e of [ghErr('gh: Not Found (HTTP 404)'), ghErr('gh: Validation Failed (HTTP 422)')]) {
    const w = world({ failOn: (s) => (s.startsWith('workflow run') ? e : null) })
    await assert.rejects(handoffExec(dispatchStep, w.deps))
    assert.equal(w.comments[5], undefined); assert.equal(w.labels.size, 0)
  }
})
test('5: judged from the failing call itself — an earlier successful call mentioning limits/HTTP 500 does not defer a 404', async () => {
  // earlier read succeeds with limit-flavoured output; only the failing dispatch's own error counts
  const w = world({ failOn: (s) => (s.startsWith('workflow run') ? ghErr('gh: Not Found (HTTP 404)') : null) })
  const base = w.deps.gh
  w.deps.gh = async (a, o) => { const r = await base(a, o); return a.join(' ').includes('/events') ? `${r}\nAPI rate limit exceeded HTTP 500` : r }
  await assert.rejects(handoffExec(dispatchStep, w.deps))
  assert.equal(w.comments[5], undefined); assert.equal(w.labels.size, 0)
  // and the inverse: a real 5xx on the failing call itself does defer
  const w2 = world({ failOn: (s) => (s.startsWith('workflow run') ? S500() : null) })
  assert.equal((await handoffExec(dispatchStep, w2.deps)).status, 'deferred')
})
test('6: a marker 300 comments deep is found; unlabelled tickets are not scanned', async () => {
  const w = world(); w.comments[5] = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, body: 'x' }))
  w.comments[5].push({ id: 999, body: handoffMarker({ ...dispatchStep, since: new Date(T0).toISOString() }) })
  w.comments[6] = [{ id: 998, body: handoffMarker({ ...dispatchStep, issue: 6, since: new Date(T0).toISOString() }) }]
  w.labels.add('5:handoff:pending')
  const r = await sweep(w.deps); assert.equal(r.replayed, 1); assert.equal(w.dispatched, 1)
})
test('7: run titles match the run-name in each workflow file', () => {
  for (const [wf, tpl] of Object.entries(RUN_NAME))
    assert.ok(readFileSync(new URL(`../../.github/workflows/${wf}`, import.meta.url), 'utf8').includes(`run-name: "${tpl}"`), wf)
  assert.equal(handoffRunTitle('work-issue-pidev.yml', { issue: 5, mode: 'build', plan: '9' }), 'work #5 build 9')
  assert.equal(handoffRunTitle('work-issue-pidev.yml', { issue: 5, mode: 'build', feedback: '3' }), 'work #5 revise 3')
  assert.equal(handoffRunTitle('work-issue-pidev.yml', { issue: 5, mode: 'plan' }), 'work #5 plan -')
})
test('8: marker write falls back to the second token; both failing rethrows', async () => {
  const w = world({ failOn: (s, t) => (s.startsWith('workflow run') ? S500() : t === 'app' && s.includes('/comments') ? LIMIT() : null) })
  await handoffExec(dispatchStep, w.deps); assert.equal(w.comments[5].length, 1)
  const w2 = world({ failOn: (s) => (s.startsWith('workflow run') ? S500() : s.includes('/comments') ? LIMIT() : null) })
  await assert.rejects(handoffExec(dispatchStep, w2.deps))
})
test('9: pending 24 h after since → sweep reports it', async () => {
  const w = world({ failOn: (s) => (s.startsWith('workflow run') ? S500() : null) })
  await handoffExec(dispatchStep, w.deps); w.t += 25 * 3600e3
  const r = await sweep(w.deps); assert.equal(r.stale.length, 1)
})
