import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyHandoffError, RUN_NAME, handoffRunTitle, labelHandoffDone, handoffMarker, parseHandoff } from './handoff.mjs'
import { handoffExec, handoffGuard, deferMergeCheck, recordFailed } from '../handoff-exec.mjs'
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
      ;(w.comments[m[1]] ||= []).push({ id: w.nextId++, body: body().slice(5), updated_at: new Date(w.t).toISOString() }); return ''
    }],
    [/issues\/comments\/(\d+)/, (m) => {
      for (const l of Object.values(w.comments)) for (const c of l) if (c.id == m[1]) { c.body = body().slice(5); c.updated_at = new Date(w.t).toISOString() }
      return ''
    }],
    [/issues\/(\d+)\/labels\/(.+)$/, (m) => { if (args.includes('DELETE')) w.labels.delete(`${m[1]}:${decodeURIComponent(m[2])}`); return '' }],
    [/issues\/(\d+)\/labels/, (m) => {
      const l = body().slice(9); w.labels.add(`${m[1]}:${l}`); w.adds = (w.adds || 0) + (l === 'handoff:pending' ? 0 : 1)
      w.events.push({ event: 'labeled', created_at: new Date(w.t).toISOString(), label: { name: l }, actor: { login: 'nuxt-harness[bot]' } })
      return ''
    }],
    [/issues\/\d+\/events/, () => j(w.events)],
    [/actions\/workflows/, () => j(w.runs)],
    [/issues\?labels=/, () => [...w.labels].filter((l) => l.endsWith(':handoff:pending')).map((l) => l.split(':')[0]).join('\n')],
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
  assert.equal(handoffRunTitle('work-issue-pidev.yml', { issue: 5, mode: 'build', plan: '9' }), '#5 · build')
  assert.equal(handoffRunTitle('work-issue-pidev.yml', { issue: 5, mode: 'build', feedback: '3' }), '#5 · build · revise')
  assert.equal(handoffRunTitle('work-issue-pidev.yml', { issue: 5, mode: 'plan' }), '#5 · plan')
  assert.equal(handoffRunTitle('automerge-epic-subpr.yml', { pr: '7' }), 'automerge #7')
  assert.equal(handoffRunTitle('ticket-revise.yml', { epic: 7 }), 'ticket-revise #7')
  assert.equal(handoffRunTitle('postmortem.yml', { epic: '12' }), 'postmortem #12')
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

// A real failing `gh` through execFileSync: the error carries status=1 plus gh's stderr (#3306).
test('classifyHandoffError reads stderr of a real execFileSync failure (status=1)', async () => {
  const { execFileSync } = await import('node:child_process')
  const run = (msg) => {
    try { execFileSync('sh', ['-c', `echo '${msg}' >&2; exit 1`], { encoding: 'utf8', stdio: 'pipe' }) } catch (e) { return e }
  }
  const lim = run('gh: API rate limit exceeded for installation ID 1 (HTTP 403)')
  assert.equal(lim.status, 1)
  assert.deepEqual(classifyHandoffError(lim), { action: 'defer', reason: 'limit', resetAt: null })
  const srv = run('could not create workflow dispatch event: HTTP 500 (x)')
  assert.equal(srv.status, 1)
  assert.deepEqual(classifyHandoffError(srv), { action: 'defer', reason: 'server' })
  assert.equal(classifyHandoffError(run('gh: Not Found (HTTP 404)')).action, 'throw')
})

// #3361: the merge check's outer catch saves a retry on limit / 5xx; anything else stays red.
const OCTO_LIMIT = () => Object.assign(new Error('API rate limit exceeded for installation ID 1'), { status: 403, response: { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(T0 / 1000 + 1800) } } })
const pendingMarkers = (w, n) => (w.comments[n] || []).filter((c) => parseHandoff(c.body))
test('10: merge check hit by the limit -> a retry is saved; the sweep replays it once', async () => {
  const w = world(); const warns = []
  const r = await deferMergeCheck(OCTO_LIMIT(), 7, w.deps, (m) => warns.push(m))
  assert.equal(r.recorded, true); assert.equal(warns.length, 1)
  const ms = pendingMarkers(w, 7); assert.equal(ms.length, 1)
  const step = parseHandoff(ms[0].body)
  assert.equal(step.workflow, 'automerge-epic-subpr.yml'); assert.equal(step.inputs.pr, '7'); assert.equal(step.reason, 'limit')
  assert.ok(w.labels.has('7:handoff:pending'))
  w.t += 3600e3
  await sweep(w.deps); assert.equal(w.dispatched, 1)
  await sweep(w.deps); assert.equal(w.dispatched, 1)
})
test('10a: a 502 in the merge check is saved the same way', async () => {
  const w = world()
  const r = await deferMergeCheck(Object.assign(new Error('Bad Gateway'), { status: 502 }), 7, w.deps, () => {})
  assert.equal(r.recorded, true); assert.equal(parseHandoff(pendingMarkers(w, 7)[0].body).reason, 'server')
})
test('10b: a run titled automerge #7 after since already exists -> the replay does not dispatch', async () => {
  const w = world({ runs: [{ display_title: 'automerge #7', created_at: new Date(T0 + 1800e3).toISOString() }] })
  await deferMergeCheck(OCTO_LIMIT(), 7, w.deps, () => {})
  w.t += 3600e3
  await sweep(w.deps); assert.equal(w.dispatched || 0, 0)
})
test('10c: any other error rethrows and saves nothing', async () => {
  for (const e of [Object.assign(new Error('Not Found'), { status: 404 }), new TypeError('boom')]) {
    const w = world(); const warns = []
    await assert.rejects(deferMergeCheck(e, 7, w.deps, (m) => warns.push(m)), (x) => x === e)
    assert.equal(pendingMarkers(w, 7).length, 0); assert.ok(!w.labels.has('7:handoff:pending')); assert.equal(warns.length, 0)
  }
})
test('10d: limit with no PR in hand -> green, nothing saved', async () => {
  const w = world()
  assert.deepEqual(await deferMergeCheck(OCTO_LIMIT(), null, w.deps, () => {}), { recorded: false })
  assert.equal(w.calls.length, 0)
})
test('10e: both tokens fail to write the retry -> still green, says so', async () => {
  const w = world({ failOn: (s) => (s.includes('/comments') ? LIMIT() : null) }); const warns = []
  const r = await deferMergeCheck(OCTO_LIMIT(), 7, w.deps, (m) => warns.push(m))
  assert.deepEqual(r, { recorded: false }); assert.ok(warns.some((m) => /retry not recorded/.test(m)))
  // #4202: the label went on first, so the sweep sees the ticket and reports the missing step
  assert.ok(warns.some((m) => /token 1 of 2/.test(m) && /token 2 of 2/.test(m)))
  assert.ok(w.labels.has('7:handoff:pending'))
  w.failOn = () => null; w.t += 11 * 60e3
  const s = await sweep(w.deps)
  assert.ok(s.failures.includes('#7 handoff:pending without a saved step'), JSON.stringify(s.failures))
})

// #4202 — label before note; one error naming every token; the sweep reports a label with no saved step.
const S502G = () => ghErr('gh: Bad gateway (HTTP 502)')
const FORBID = () => ghErr('gh: Resource not accessible by integration (HTTP 403)')
const DROP = 'DELETE repos/o/r/issues/5/labels/handoff%3Apending'
const pendingEvent = (ms) => ({ event: 'labeled', created_at: new Date(ms).toISOString(), label: { name: 'handoff:pending' }, actor: { login: 'nuxt-harness[bot]' } })

// covers: T1
test('H1: label POST fails for both tokens → no note, one error naming each token', async () => {
  const w = world({ failOn: (s, t) => {
    if (s.startsWith('workflow run')) return S502G()
    if (/labels\[\]=handoff:pending/.test(s)) return t === 'app' ? S502G() : FORBID()
    return null
  } })
  await assert.rejects(handoffExec(dispatchStep, w.deps), (e) => {
    assert.match(e.message, /token 1 of 2: gh: Bad gateway \(HTTP 502\)/)
    assert.match(e.message, /token 2 of 2: gh: Resource not accessible by integration \(HTTP 403\)/)
    assert.ok(!/\bapp\b|\bfb\b/.test(e.message), 'never the token value')
    return true
  })
  assert.equal(w.comments[5], undefined)
  assert.ok(!w.calls.some((c) => /POST repos\/o\/r\/issues\/5\/comments/.test(c)))
})

// covers: T2
test('H2: the pending label is posted before the note', async () => {
  const w = world({ failOn: (s) => (s.startsWith('workflow run') ? S502G() : null) })
  assert.equal((await handoffExec(dispatchStep, w.deps)).status, 'deferred')
  const label = w.calls.findIndex((c) => /issues\/5\/labels .*labels\[\]=handoff:pending/.test(c))
  const note = w.calls.findIndex((c) => /POST repos\/o\/r\/issues\/5\/comments/.test(c))
  assert.ok(label >= 0 && note >= 0 && label < note, `label ${label} note ${note}`)
})

// covers: T3
test('H3a/H3c: a 1 h-old label with no saved step is reported and kept; a newer done note drops it', async () => {
  const w = world({ events: [pendingEvent(T0 - 3600e3)] })
  w.comments[5] = []; w.labels.add('5:handoff:pending')
  const r = await sweep(w.deps)
  assert.deepEqual(r.failures, ['#5 handoff:pending without a saved step'])
  assert.ok(!w.calls.some((c) => c.includes(DROP))); assert.ok(w.labels.has('5:handoff:pending'))
  // H3c: only a done note, updated after the label went on → a leftover; drop it quietly
  const w2 = world({ events: [pendingEvent(T0 - 3600e3)] })
  w2.comments[5] = [{ id: 1, body: '<!-- handoff-done:v1 -->\n✅ replayed at 09:30 UTC', updated_at: new Date(T0 - 1800e3).toISOString() }]
  w2.labels.add('5:handoff:pending')
  const r2 = await sweep(w2.deps)
  assert.deepEqual(r2.failures, []); assert.ok(w2.calls.some((c) => c.includes(DROP))); assert.ok(!w2.labels.has('5:handoff:pending'))
})

// covers: T4
test('H3b: a 2 min-old label with no saved step is left alone (grace period)', async () => {
  const w = world({ events: [pendingEvent(T0 - 2 * 60e3)] })
  w.comments[5] = []; w.labels.add('5:handoff:pending')
  const r = await sweep(w.deps)
  assert.deepEqual(r.failures, []); assert.ok(!w.calls.some((c) => c.includes(DROP))); assert.ok(w.labels.has('5:handoff:pending'))
})

// covers: T5
test('H5: whichever save call fails for both tokens, never a note without the label', async () => {
  const steps = [/labels\[\]=handoff:pending/, /GET|--paginate repos\/o\/r\/issues\/5\/comments/, /POST repos\/o\/r\/issues\/5\/comments/]
  for (const re of steps) {
    const w = world({ failOn: (s) => (s.startsWith('workflow run') ? S502G() : re.test(s) && s.includes('issues/5/') ? S502G() : null) })
    let err = null
    try { await handoffExec(dispatchStep, w.deps) } catch (e) { err = e }
    const label = w.labels.has('5:handoff:pending'); const note = pendingMarkers(w, 5).length > 0
    if (err) { assert.match(err.message, /token 1 of 2/, String(re)); assert.match(err.message, /token 2 of 2/, String(re)) }
    else assert.ok(label && note, String(re))
    assert.ok(!(note && !label), `note without label for ${re}`)
  }
})

const S502 = () => Object.assign(new Error('bad gateway'), { status: 502 })
test('3g: guard — a 5xx that hid a landed label is not repeated by the sweep', async () => {
  const w = world()
  const step = { kind: 'label', issue: 6, label: 'work-this' }
  const r = await handoffGuard(step, async () => {
    w.events.push({ event: 'labeled', created_at: new Date(w.t).toISOString(), label: { name: 'work-this' }, actor: { login: 'nuxt-harness[bot]' } })
    w.t += 5000; throw S502()
  }, w.deps)
  assert.equal(r.deferred, true)
  assert.match(w.comments[6][0].body, new RegExp(new Date(T0).toISOString()))
  w.t += 3600e3; await sweep(w.deps)
  assert.ok(!w.adds)
  assert.ok(!w.calls.some((c) => /DELETE/.test(c) && /work-this/.test(c)))
  assert.match(w.comments[6][0].body, /handoff-done/)
})
test('3h: guard — a dispatch whose 5xx hid a created run is not dispatched again', async () => {
  const w = world()
  const step = { ...dispatchStep }
  await handoffGuard(step, async () => {
    w.runs.push({ display_title: handoffRunTitle(step.workflow, step.inputs), created_at: new Date(w.t).toISOString() })
    w.t += 5000; throw S502()
  }, w.deps)
  w.t += 3600e3; await sweep(w.deps)
  assert.equal(w.dispatched, undefined)
})
test('3i: record path keeps the caller\'s pre-call since', async () => {
  const w = world(); w.t = T0 + 60e3
  await recordFailed({ step: { kind: 'label', issue: 5, label: 'work-this', since: '2026-11-04T09:59:00.000Z' }, reason: 'server' }, w.deps)
  assert.match(w.comments[5][0].body, /2026-11-04T09:59:00\.000Z/)
  const w2 = world(); w2.t = T0 + 60e3
  await recordFailed({ step: { kind: 'label', issue: 5, label: 'work-this' }, reason: 'server' }, w2.deps)
  assert.match(w2.comments[5][0].body, /2026-11-04T10:01:00\.000Z/)
})
test('3j: deferHandoff passes since taken before fn()', async () => {
  const { deferHandoff } = await import('../apply-decompose-plan.mjs')
  let clock = T0; const calls = []
  deferHandoff((cmd, args) => { calls.push(args); return '' }, { kind: 'label', issue: 5, label: 'work-this' },
    () => { clock += 5000; throw ghErr('HTTP 500') }, { pending: [], log() {}, now: () => clock })
  assert.equal(JSON.parse(calls[0].at(-1)).step.since, new Date(T0).toISOString())
})

// #4184 T3 — plan-build with a `### Split`: the moved part is filed once, under the epic, then the build is dispatched.
const SPLIT_PLAN = '<!-- pipeline-plan:v1 -->\n### Fix\nbuild part 1\n### Split\nyes — Browser tests\n- Moves: "7 e2e tests"\n- Why: too big\n'
const NO_SPLIT_PLAN = '<!-- pipeline-plan:v1 -->\n### Fix\nbuild it all\n'
const ORIG = { body: '## 🤖 For agents\n- "7 e2e tests"\n<!-- pipeline: epic=4095 step=1 epic_branch=epic/4095-x dispatch=work-this -->', labels: ['pkg:crouton-auth', 'plan:approved', 'work-this', 'status:in-progress'] }

// Comment listings on #5: the plan lookup, the split-note lookup, or the hand-off pending-marker listing (none yet).
function splitCommentList(w, s) {
  if (s.includes('pipeline-plan:v1')) return '777\n'
  const m = s.match(/plan-split-note:v1 #(\d+)/)
  if (!m) return ''
  return w.notes.some((b) => b.startsWith(`<!-- plan-split-note:v1 #${m[1]} -->`)) ? '4242\n' : ''
}
function splitTimeline(w, s) {
  const marker = s.match(/contains\("(.+?)"\)/)[1]
  return w.timeline.filter((i) => i.body.includes(marker)).map(({ number, id }) => JSON.stringify({ number, id })).join('\n')
}
function splitCreate(w, args) {
  const i = { number: 900 + w.created.length, id: 9000 + w.created.length, args }
  w.created.push(i); w.timeline.push({ number: i.number, id: i.id, body: args[args.indexOf('-f', 5) + 1] })
  return JSON.stringify({ number: i.number, id: i.id })
}
function splitParent(w, m) {
  if (!w.parents[m[1]]) throw ghErr('gh: No parent issue found (HTTP 404)')
  return `${w.parents[m[1]]}\n`
}
function splitLink(w, m) {
  w.links.push({ parent: Number(m[1]), id: Number(m[2]) })
  w.parents[w.timeline.find((i) => i.id === Number(m[2])).number] = Number(m[1])
  return ''
}
function splitPost(w, args) {
  const b = args.at(-1).slice(5)
  ;(b.startsWith('<!-- plan-split-note') ? w.notes : (w.pending ||= [])).push(b)
  return ''
}
// Route table for the split fake: first matching pattern answers.
const splitRoutes = (w, plan, args, s) => [
  [/^workflow run/, () => { w.dispatched++; return '' }],
  [/issues\/5\/comments\?per_page/, () => splitCommentList(w, s)],
  [/issues\/comments\/777 /, () => JSON.stringify({ body: plan, html_url: 'https://github.com/o/r/issues/5#issuecomment-777' })],
  [/repos\/o\/r\/issues\/5 --jq/, () => JSON.stringify(ORIG)],
  [/issues\/5\/timeline/, () => splitTimeline(w, s)],
  [/^api -X POST repos\/o\/r\/issues -f/, () => splitCreate(w, args)],
  [/issues\/(\d+)\/parent/, (m) => splitParent(w, m)],
  [/POST repos\/o\/r\/issues\/(\d+)\/sub_issues -F sub_issue_id=(\d+)/, (m) => splitLink(w, m)],
  [/POST repos\/o\/r\/issues\/5\/comments/, () => splitPost(w, args)],
  [/POST repos\/o\/r\/issues\/5\/labels/, () => ''],
]

// Fake GitHub for the split path: #5 (plan comment 777), its timeline, parents, created issues.
function splitWorld({ plan = SPLIT_PLAN, parents = { 5: 4095 }, timeline = [], notes = [] } = {}) {
  const w = { calls: [], created: [], links: [], notes: [...notes], timeline: [...timeline], parents: { ...parents }, dispatched: 0 }
  w.deps = {
    repo: 'o/r', tokens: ['app'], log: () => {}, now: () => T0,
    gh: async (args) => {
      const s = args.join(' ')
      w.calls.push(s)
      for (const [re, fn] of splitRoutes(w, plan, args, s)) { const m = re.exec(s); if (m) return fn(m) }
      throw new Error('unexpected gh ' + s)
    },
  }
  return w
}
const filedBody = (w) => { const a = w.created[0].args; return a[a.indexOf('-f', 5) + 1] }

test('#4184 T3a: a yes Split with a parent epic → one issue, linked once, the note, then the build dispatch', async () => {
  const w = splitWorld()
  const r = await handoffExec({ kind: 'plan-build', issue: 5 }, w.deps)
  assert.equal(r.status, 'done')
  assert.equal(w.created.length, 1)
  const a = w.created[0].args
  assert.ok(a.includes('title=Browser tests'))
  assert.match(filedBody(w), /^body=<!-- plan-split:v1 from #5 plan=777 -->/)
  assert.match(filedBody(w), /^Blocked-by: #5$/m)
  assert.deepEqual(a.filter((x) => x.startsWith('labels[]=')), ['labels[]=pkg:crouton-auth'])
  assert.deepEqual(w.links, [{ parent: 4095, id: 9000 }]) // the REST id, not the number
  assert.equal(w.notes.length, 1)
  assert.equal(w.notes[0], '<!-- plan-split-note:v1 #900 -->\nSplit: the rest moved to #900, which starts when this one closes.')
  assert.equal(w.dispatched, 1)
  assert.ok(w.calls.at(-1).includes('-f plan=777'))
})

test('#4184 T3b: replay — issue already filed and linked, note missing → no issue, no sub_issues POST, note once, dispatch', async () => {
  const w = splitWorld({ timeline: [{ number: 900, id: 9000, body: '<!-- plan-split:v1 from #5 plan=777 -->\n…' }], parents: { 5: 4095, 900: 4095 } })
  await handoffExec({ kind: 'plan-build', issue: 5 }, w.deps)
  assert.equal(w.created.length, 0)
  assert.equal(w.links.length, 0)
  assert.ok(!w.calls.some((c) => /sub_issues/.test(c)))
  assert.equal(w.notes.length, 1)
  assert.equal(w.dispatched, 1)
  // and a second replay (note now there) posts nothing more
  await handoffExec({ kind: 'plan-build', issue: 5 }, w.deps)
  assert.equal(w.created.length, 0); assert.equal(w.notes.length, 1); assert.equal(w.dispatched, 2)
})

test('#4184 T3c: replay — issue filed but never linked (its /parent is 404) → linked exactly once with the timeline id', async () => {
  const w = splitWorld({ timeline: [{ number: 901, id: 9901, body: 'x <!-- plan-split:v1 from #5 plan=777 --> y' }] })
  await handoffExec({ kind: 'plan-build', issue: 5 }, w.deps)
  assert.equal(w.created.length, 0)
  assert.deepEqual(w.links, [{ parent: 4095, id: 9901 }])
  assert.equal(w.dispatched, 1)
  // a marker for a different plan comment is not a match
  const other = splitWorld({ timeline: [{ number: 902, id: 9902, body: '<!-- plan-split:v1 from #5 plan=111 -->' }] })
  await handoffExec({ kind: 'plan-build', issue: 5 }, other.deps)
  assert.equal(other.created.length, 1)
})

test('#4184 T3c′: a 5xx on the sub-issue link defers; the replay links once and files no second issue', async () => {
  const w = splitWorld()
  const gh = w.deps.gh
  let fail = true
  w.deps.gh = async (args, o) => { if (fail && args.join(' ').includes('sub_issues')) { fail = false; throw S500() } return gh(args, o) }
  const first = await handoffExec({ kind: 'plan-build', issue: 5 }, w.deps)
  assert.equal(first.status, 'deferred'); assert.equal(w.pending.length, 1)
  assert.equal(w.created.length, 1); assert.equal(w.links.length, 0); assert.equal(w.dispatched, 0)
  // the replay re-runs the resolver (handoff-exec performDispatch)
  await handoffExec({ kind: 'plan-build', issue: 5 }, w.deps)
  assert.equal(w.created.length, 1); assert.deepEqual(w.links, [{ parent: 4095, id: 9000 }]); assert.equal(w.dispatched, 1)
})

test('#4184 T3d: a plan without Split → only the dispatch, nothing filed, linked or noted', async () => {
  const w = splitWorld({ plan: NO_SPLIT_PLAN })
  await handoffExec({ kind: 'plan-build', issue: 5 }, w.deps)
  assert.equal(w.created.length, 0); assert.equal(w.links.length, 0); assert.equal(w.notes.length, 0)
  assert.ok(!w.calls.some((c) => /timeline|parent|sub_issues|POST/.test(c)))
  assert.equal(w.dispatched, 1)
  // no parent epic → a split is still filed, just not linked
  const solo = splitWorld({ parents: {} })
  await handoffExec({ kind: 'plan-build', issue: 5 }, solo.deps)
  assert.equal(solo.created.length, 1); assert.equal(solo.links.length, 0); assert.equal(solo.dispatched, 1)
})
