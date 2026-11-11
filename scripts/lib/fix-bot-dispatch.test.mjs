import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideFixBotDispatch, pickFailedRun, fixBotWillTry, fixOrDiagnose, expectedRunConclusion, redPingHeading, FIX_BOT_WORKFLOWS } from './fix-bot-dispatch.mjs'

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

test('redPingHeading: never @mentions (#3622)', () => {
  for (const who of ['bot', 'gave-up', 'owner', 'none']) {
    for (const r of [{ head: 'work-1', base: 'epic/1-x' }, { head: 'epic/3-x', base: 'main' }]) {
      const x = redPingHeading({ who, count: 1, list: '`x`', reason: 'because', ...r })
      assert.ok(!(x.heading + x.needed).includes('@'), `${who} ${r.head}`)
    }
  }
  const o = redPingHeading({ who: 'owner', count: 1, list: '`x`', head: 'work-1', base: 'epic/1-x', reason: 'because' })
  assert.match(o.needed, /because/)
})

// Lockstep with the workflows (read as text)
const fixYml = readFileSync(new URL('../../.github/workflows/fix-ci-on-failure.yml', import.meta.url), 'utf8')
const statusYml = readFileSync(new URL('../../.github/workflows/status.yml', import.meta.url), 'utf8')
const statusSrc = readFileSync(new URL('./pr-status-io.mjs', import.meta.url), 'utf8') // the red ping moved here (#3617)
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
test('lockstep: the status red ping (pr-status-io.mjs) uses the shared decision and builder', () => {
  assert.ok(statusSrc.includes('fixBotWillTry(')); assert.ok(statusSrc.includes('redPingHeading('))
  assert.ok(!statusSrc.includes('`🔴 **@${OWNER} — CI failed '))
  assert.ok(!statusSrc.includes("'mentioned @' + OWNER"))
  assert.ok(!statusYml.includes('`🔴 **@${OWNER} — CI failed '), 'no second heading copy in status.yml either')
})

test('redPingHeading: epic → main wording', async () => {
  const { redPingHeading } = await import('./fix-bot-dispatch.mjs')
  const h = redPingHeading({ who: 'owner', owner: 'pmcp', base: 'main', head: 'epic/3-x', count: 1, list: '`A`' })
  const all = h.heading + h.needed
  assert.ok(!all.includes('@'))
  assert.ok(all.includes("won't merge"))
  assert.ok(!all.includes('sub-PR'))
})

// ── #3667: fixOrDiagnose — a repeat red after one fix try gets a diagnosis, not another fix
test('fixOrDiagnose: first red (no ci-fix-attempts) → fix', () =>
  assert.equal(fixOrDiagnose({ labels: [], failures: [F('CI')] }), 'fix'))
test('fixOrDiagnose: ci-fix-attempts:1 + CI red → diagnose', () =>
  assert.equal(fixOrDiagnose({ labels: ['ci-fix-attempts:1'], failures: [F('CI')] }), 'diagnose'))
test('fixOrDiagnose: ci-fix-attempts:2 + E2E red → diagnose', () =>
  assert.equal(fixOrDiagnose({ labels: ['ci-fix-attempts:2'], failures: [F('E2E')] }), 'diagnose'))
test('fixOrDiagnose: red only outside FIX_BOT_WORKFLOWS → fix, and fixBotWillTry keeps today’s owner/not-watched', () => {
  assert.equal(fixOrDiagnose({ labels: ['ci-fix-attempts:1'], failures: [F('Packages guard')] }), 'fix')
  const r = w({ labels: ['ci-fix-attempts:1'], failures: [F('Packages guard')] })
  assert.equal(r.who, 'owner'); assert.equal(r.code, 'not-watched'); assert.equal(r.mode, 'fix')
})
test('fixOrDiagnose: non-failure conclusion → fix', () =>
  assert.equal(fixOrDiagnose({ labels: ['ci-fix-attempts:1'], failures: [F('CI', 'cancelled')] }), 'fix'))
test('willTry: ci-fix-attempts:1 → bot in diagnose mode, attempts 1', () => {
  const r = w({ labels: ['ci-fix-attempts:1'] })
  assert.equal(r.who, 'bot'); assert.equal(r.mode, 'diagnose'); assert.equal(r.attempts, 1)
})
test('willTry: first red → bot in fix mode; ci-fix-attempts:3 → still gave-up', () => {
  assert.equal(w().mode, 'fix')
  const g = w({ labels: ['ci-fix-attempts:3'] }); assert.equal(g.who, 'gave-up'); assert.equal(g.mode, 'fix')
})
test('redPingHeading: diagnose mode says diagnosis, no mention; fix mode keeps "attempt N of 3"', () => {
  const dg = redPingHeading({ who: 'bot', mode: 'diagnose', attempts: 1, count: 1, list: '`x`' })
  assert.match(dg.needed, /diagnosis/); assert.ok(!(dg.heading + dg.needed).includes('@'))
  const fx = redPingHeading({ who: 'bot', mode: 'fix', attempts: 1, count: 1, list: '`x`' })
  assert.match(fx.needed, /attempt 2 of 3/)
})
test('lockstep: the status red ping passes the mode through', () => assert.ok(statusSrc.includes('mode: dec.mode')))

// Steps of the fixbot job, read as text: `- name: X` → the step's lines up to the next step.
const stepText = (name) => {
  const i = fixYml.indexOf(`- name: ${name}\n`)
  assert.ok(i >= 0, `step ${name} exists`)
  const rest = fixYml.slice(i + 2)
  const j = rest.search(/\n {6}- /)
  return rest.slice(0, j < 0 ? undefined : j)
}
const ifOf = (name) => (/\n\s+if: (.*)/.exec(stepText(name)) || [])[1] || ''
test('lockstep (#3667): the gate computes and outputs the mode', () => {
  assert.ok(fixYml.includes('d.mode')); assert.ok(fixYml.includes("setOutput('mode'"))
})
test('lockstep (#3667): commit and push run in fix mode only', () => {
  for (const s of ['Commit the staged fix', 'Guard and push the fix']) assert.match(ifOf(s), /mode == 'fix'/, s)
  assert.match(ifOf('Fix attempt'), /mode == 'fix'/)
})
test('lockstep (#3667): the diagnose step uses the hard tier and keeps git commit/push disallowed', () => {
  const dg = stepText('Diagnose the repeat red')
  assert.match(ifOf('Diagnose the repeat red'), /mode == 'diagnose'/)
  assert.ok(dg.includes("Bash(git commit:*)")); assert.ok(dg.includes("Bash(git push:*)"))
  assert.ok(dg.includes('diagnose.md'))
  assert.match(stepText('Resolve model'), /resolve-pipeline-model\.mjs \$\{\{ steps\.gate\.outputs\.mode == 'diagnose' && 'hard'/)
  assert.match(ifOf('Check the diagnosis was posted'), /mode == 'diagnose'/)
})
test('lockstep (#3667): failing logs are read before the agent steps', () => {
  assert.ok(fixYml.indexOf('- name: Read the failing job logs') < fixYml.indexOf('- name: Fix attempt'))
  assert.ok(fixYml.indexOf('- name: Read the failing job logs') < fixYml.indexOf('- name: Diagnose the repeat red'))
})

test('redPingHeading: work-* → main keeps the pipeline wording', async () => {
  const { redPingHeading } = await import('./fix-bot-dispatch.mjs')
  const h = redPingHeading({ who: 'owner', owner: 'pmcp', reason: 'the auto-fix stands down while the PR is blocked', base: 'main', head: 'work-3006', count: 1, list: '`A`' })
  const all = h.heading + h.needed
  assert.ok(all.includes('pipeline PR'))
  assert.ok(all.includes('stands down'))
  assert.ok(!all.includes('epic PR'))
})
