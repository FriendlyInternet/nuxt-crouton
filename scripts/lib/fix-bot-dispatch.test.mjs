import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideFixBotDispatch, pickFailedRun, fixBotWillTry, expectedRunConclusion, redPingHeading, FIX_BOT_WORKFLOWS } from './fix-bot-dispatch.mjs'

const yes = { go: true, reason: 'ok' }
const no = { go: false, reason: 'a commit landed after the approval' }
const d = (o) => decideFixBotDispatch({ head: 'epic/3105-x', base: 'main', state: 'open', go: yes, ...o })

test('epic → main, open, standing ok → run', () => assert.equal(d().run, true))
test('epic → main without a standing ok → skip with the reason', () => {
  const r = d({ go: no })
  assert.equal(r.run, false); assert.match(r.reason, /after the approval/)
})
test('epic head into a non-main base → skip', () => assert.equal(d({ base: 'epic/1-y' }).run, false))
test('closed PR → skip', () => assert.equal(d({ state: 'closed' }).run, false))
test('work-* runs unchanged, even without go', () => assert.equal(d({ head: 'work-12', go: undefined }).run, true))
test('non-pipeline head → skip', () => assert.equal(d({ head: 'feature/x' }).run, false))

test('pickFailedRun: none failed → null', () => {
  assert.equal(pickFailedRun([{ id: 1, name: 'CI', conclusion: 'success' }]), null)
  assert.equal(pickFailedRun([]), null)
})
test('pickFailedRun: newest CI/E2E failure wins, other workflows ignored', () => {
  const r = pickFailedRun([
    { id: 1, name: 'CI', conclusion: 'failure', created_at: '2026-01-01T00:00:00Z' },
    { id: 2, name: 'E2E', conclusion: 'failure', created_at: '2026-01-01T02:00:00Z' },
    { id: 3, name: 'Lint', conclusion: 'failure', created_at: '2026-01-01T03:00:00Z' },
  ])
  assert.equal(r.id, 2)
})

// ── #3373: fixBotWillTry — the rule both workflows run
const base = { head: 'work-12', base: 'epic/1-x', state: 'open', labels: [], failures: [{ workflow: 'CI', conclusion: 'failure' }] }
const w = (o) => fixBotWillTry({ ...base, ...o })
const F = (workflow, conclusion = 'failure') => ({ workflow, conclusion })

test('willTry: base → bot, attempts 0', () => { const r = w(); assert.equal(r.who, 'bot'); assert.equal(r.attempts, 0) })
test('willTry: CI + E2E + Deploy all failure → bot', () =>
  assert.equal(w({ failures: [F('CI'), F('E2E'), F('Deploy Apps (Cloudflare Workers)')] }).who, 'bot'))
test('willTry: unwatched workflow → owner, names it', () => {
  const r = w({ failures: [F('Packages guard')] })
  assert.equal(r.who, 'owner'); assert.equal(r.code, 'not-watched'); assert.match(r.reason, /Packages guard/)
})
test('willTry: mixed CI + Review → owner', () => assert.equal(w({ failures: [F('CI'), F('Review')] }).who, 'owner'))
test('willTry: commit status (null workflow) → owner not-watched', () => {
  const r = w({ failures: [{ workflow: null, conclusion: null }] })
  assert.equal(r.who, 'owner'); assert.equal(r.code, 'not-watched')
})
for (const c of ['timed_out', 'action_required', 'stale', 'cancelled']) {
  test(`willTry: ${c} → owner not-failure`, () => {
    const r = w({ failures: [F('CI', c)] })
    assert.equal(r.who, 'owner'); assert.equal(r.code, 'not-failure')
  })
}
test('willTry: attempts 3 → gave-up; 2 → bot', () => {
  assert.equal(w({ labels: ['ci-fix-attempts:3'] }).who, 'gave-up')
  const r = w({ labels: ['ci-fix-attempts:2'] })
  assert.equal(r.who, 'bot'); assert.equal(r.attempts, 2); assert.equal(r.attemptLabel, 'ci-fix-attempts:2')
})
test('willTry: status:blocked → owner blocked', () => {
  const r = w({ labels: ['status:blocked'] }); assert.equal(r.who, 'owner'); assert.equal(r.code, 'blocked')
})
test('willTry: feature head / closed → owner not-eligible', () => {
  assert.equal(w({ head: 'feature/x' }).code, 'not-eligible')
  const r = w({ state: 'closed' }); assert.equal(r.code, 'not-eligible'); assert.match(r.reason, /not open/)
})
test('willTry: epic head → owner automatic, bot when manual', () => {
  const o = { head: 'epic/9-x', base: 'main', go: yes }
  assert.equal(w(o).who, 'owner')
  assert.equal(w({ ...o, manual: true }).who, 'bot')
})
test('willTry: manual with no failed run → none', () => assert.equal(w({ manual: true, failures: [] }).who, 'none'))

test('expectedRunConclusion', () => {
  assert.equal(expectedRunConclusion({ runConclusion: 'failure', checkConclusion: 'failure' }), 'failure')
  assert.equal(expectedRunConclusion({ runConclusion: null, checkConclusion: 'failure' }), 'failure')
  assert.equal(expectedRunConclusion({ runConclusion: null, checkConclusion: 'timed_out' }), 'timed_out')
  assert.equal(expectedRunConclusion({ runConclusion: 'success', checkConclusion: 'failure' }), 'success')
})

test('redPingHeading: mention only on the owner path', () => {
  const t = (o) => { const r = redPingHeading({ owner: 'pmcp', count: 1, list: '`x`', head: 'work-1', reason: 'because', ...o }); return r.heading + r.needed }
  assert.ok(!t({ who: 'bot' }).includes('@'))
  assert.ok(!t({ who: 'gave-up' }).includes('@'))
  const o = t({ who: 'owner' })
  assert.equal(o.split('@pmcp').length - 1, 1); assert.match(o, /because/)
})

// Lockstep with the workflows (read as text)
const fixYml = readFileSync(new URL('../../.github/workflows/fix-ci-on-failure.yml', import.meta.url), 'utf8')
const statusYml = readFileSync(new URL('../../.github/workflows/status.yml', import.meta.url), 'utf8')
test('lockstep: trigger workflows list equals FIX_BOT_WORKFLOWS', () => {
  const m = /^\s*workflows:\s*\[(.*)\]/m.exec(fixYml)
  assert.deepEqual(JSON.parse(`[${m[1]}]`), FIX_BOT_WORKFLOWS)
})
test('lockstep: job if keeps conclusion == failure and work-', () => {
  assert.match(fixYml, /conclusion == 'failure'/); assert.match(fixYml, /'work-'/)
})
test('lockstep: gate has no second copy of the decision', () => {
  assert.ok(fixYml.includes('fixBotWillTry('))
  for (const s of ['const MAX =', 'attempts >= MAX', "labels.includes('status:blocked')"]) assert.ok(!fixYml.includes(s), s)
})
test('lockstep: status.yml uses the shared decision and builder', () => {
  assert.ok(statusYml.includes('fixBotWillTry(')); assert.ok(statusYml.includes('redPingHeading('))
  assert.ok(!statusYml.includes('`🔴 **@${OWNER} — CI failed '))
})
