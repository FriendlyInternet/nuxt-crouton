// Rubric fixtures for the plan reviewer verdict (#2756). node --test scripts/lib/plan-verdict.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { holdOrRetry, parseVerdict, precheck, planNotes, decide, renderComment, QUESTION_RECORD, REJECTED_RECORD, SIGNOFF_QUESTION } from './plan-verdict.mjs'
import { readRecord } from './reply-record.mjs'
import { needsOwnerQuestion } from '../plan-hold.mjs'

const fx = (n) => readFileSync(new URL(`../fixtures/plan-review/${n}`, import.meta.url), 'utf8')

test('a clean plan with a clean verdict is go', () => {
  const d = decide(fx('clean.plan.md'), fx('pass.verdict.md'))
  assert.equal(d.ok, true)
  assert.equal(d.verdict, 'go')
  assert.deepEqual(d.failed, [])
})

test('replay of the "refresh keys" plan (#2701): no-go on items 1 and 2 even when the model says go', () => {
  const d = decide(fx('refresh-keys.plan.md'), fx('lenient.verdict.md'))
  assert.equal(d.ok, true)
  assert.equal(d.verdict, 'no-go')
  assert.ok(d.failed.includes('1'))
  assert.ok(d.failed.includes('2'))
})

test('"Reproduced: no" with no reason is no-go citing item 1', () => {
  const plan = fx('clean.plan.md').replace(/yes\. Booted[^\n]*/, 'no')
  assert.ok(precheck(plan)['1'])
  assert.equal(decide(plan, fx('pass.verdict.md')).verdict, 'no-go')
})

test('hedging words in Cause fail item 2', () => {
  const plan = fx('clean.plan.md').replace('The list query key omits', 'The list query key probably omits')
  assert.ok(precheck(plan)['2'])
})

test('a declared unverified assumption (with a reason) no longer fails item 3, and is surfaced as a note', () => {
  assert.equal(precheck(fx('refresh-keys.plan.md'))['3'], undefined)
  assert.ok(planNotes(fx('refresh-keys.plan.md'))['3'])
})

test('a verified assumption without a link still fails 1b', () => {
  const plan = fx('clean.plan.md').replace(/Evidence: https:\/\/\S+/, 'Evidence: grep output')
  assert.ok(precheck(plan)['1b'])
})

test('an unverified assumption with no reason still fails 1b', () => {
  const plan = fx('refresh-keys.plan.md').replace('— Why: seems right ', '')
  assert.notEqual(plan, fx('refresh-keys.plan.md'))
  assert.ok(precheck(plan)['1b'])
})

test('a clean plan has no deterministic failures', () => {
  assert.deepEqual(precheck(fx('clean.plan.md')), {})
})

test('item 7 FAIL with a question is needs-owner', () => {
  const d = decide(fx('clean.plan.md'), fx('owner.verdict.md'))
  assert.equal(d.verdict, 'needs-owner')
  assert.match(d.question, /yes\/no/)
})

test('needs-owner without a Question is rejected', () => {
  const v = fx('owner.verdict.md').replace(/### Question[\s\S]*/, '')
  assert.equal(decide(fx('clean.plan.md'), v).ok, false)
})

test('a reviewer that says go while its own rubric fails is rejected, not trusted', () => {
  const v = fx('pass.verdict.md').replace('- 4: PASS — one-line key change', '- 4: FAIL — a helper already exists')
  assert.equal(decide(fx('clean.plan.md'), v).ok, false)
})

test('item 8: a plan with no test aimed at the rule is no-go even though the precheck passes', () => {
  assert.deepEqual(precheck(fx('untested-rule.plan.md')), {})
  const d = decide(fx('untested-rule.plan.md'), fx('untested-rule.verdict.md'))
  assert.equal(d.verdict, 'no-go')
  assert.deepEqual(d.failed, ['8'])
})

test('item 9: a step that contradicts the epic record is no-go', () => {
  assert.deepEqual(precheck(fx('contradicts-record.plan.md')), {})
  const d = decide(fx('contradicts-record.plan.md'), fx('contradicts-record.verdict.md'))
  assert.equal(d.verdict, 'no-go')
  assert.deepEqual(d.failed, ['9'])
})

test('a verdict missing item 8 or 9 is rejected', () => {
  assert.equal(parseVerdict(fx('pass.verdict.md').replace(/- 8:[^\n]*\n/, '')).ok, false)
  assert.equal(parseVerdict(fx('pass.verdict.md').replace(/- 9:[^\n]*\n/, '')).ok, false)
})

test('a malformed verdict (missing marker, item, evidence, bad verdict) is rejected', () => {
  assert.equal(parseVerdict('nothing here').ok, false)
  assert.equal(parseVerdict(fx('pass.verdict.md').replace('- 6: PASS — only useList touched\n', '')).ok, false)
  assert.equal(parseVerdict(fx('pass.verdict.md').replace('- 5: PASS — no casts or timeouts', '- 5: PASS')).ok, false)
  assert.equal(parseVerdict(fx('pass.verdict.md').replace('go\n', 'maybe\n')).ok, false)
})

test('the comment carries the marker, the type and a collapsed checklist', () => {
  const c = renderComment(decide(fx('clean.plan.md'), fx('pass.verdict.md')), { model: 'x' })
  assert.match(c, /<!-- plan-review:v1 -->/)
  assert.match(c, /Plan approved/)
  assert.match(c, /<details>/)
})

test('holdOrRetry: judgement failures hold from round 2, mechanical retry until round 3', () => {
  assert.equal(holdOrRetry({ round: 1, failedChecks: ['7'] }), 'retry')
  assert.equal(holdOrRetry({ round: 1, failedChecks: ['9'] }), 'retry')
  assert.equal(holdOrRetry({ round: 2, failedChecks: ['1b', '8'] }), 'retry')
  assert.equal(holdOrRetry({ round: 2, failedChecks: ['7'] }), 'hold')
  assert.equal(holdOrRetry({ round: 2, failedChecks: ['6', '9'] }), 'hold')
  assert.equal(holdOrRetry({ round: 3, failedChecks: ['1b'] }), 'hold')
})

test('rule: a real verdict failing only a mechanical check retries at round 2; a failed 9 holds', () => {
  const mech = decide(fx('untested-rule.plan.md'), fx('untested-rule.verdict.md'))
  assert.equal(holdOrRetry({ round: 2, failedChecks: mech.failed }), 'retry')
  assert.match(renderComment(mech, { round: 2 }), /Plan sent back/)
  const judge = decide(fx('contradicts-record.plan.md'), fx('contradicts-record.verdict.md'))
  assert.equal(holdOrRetry({ round: 2, failedChecks: judge.failed }), 'hold')
  assert.match(renderComment(judge, { round: 2 }), /Held for you/)
})

test('route command: exit/stdout the workflow relies on', () => {
  const f = (n) => fileURLToPath(new URL(`../fixtures/plan-review/${n}`, import.meta.url))
  const script = fileURLToPath(new URL('./plan-verdict.mjs', import.meta.url))
  const route = (plan, verdict, round) => spawnSync('node', [script, 'route', f(plan), f(verdict), ...(round === undefined ? [] : [String(round)])], { encoding: 'utf8' })
  const out = (r) => r.stdout.trim()
  assert.deepEqual(['1', '2', '3'].map((r) => out(route('untested-rule.plan.md', 'untested-rule.verdict.md', r))), ['retry', 'retry', 'hold'])
  assert.deepEqual(['1', '2', '3'].map((r) => out(route('contradicts-record.plan.md', 'contradicts-record.verdict.md', r))), ['retry', 'hold', 'hold'])
  assert.equal(out(route('untested-rule.plan.md', 'untested-rule.verdict.md')), 'retry')
  assert.equal(out(route('untested-rule.plan.md', 'untested-rule.verdict.md', 'abc')), 'retry')
  const notNoGo = route('clean.plan.md', 'pass.verdict.md', 1)
  assert.equal(notNoGo.status, 1)
  assert.match(notNoGo.stderr, /route needs a no-go/)
})

test('rule: a pending design sign-off ends as a hold — never go, never plan:approved, rejection count unchanged', async () => {
  const { SIGNOFF_QUESTION } = await import('./plan-verdict.mjs')
  const plan = fx('clean.plan.md').replace(/### Needs owner\n[^\n]*/, '### Needs owner\nyes — design sign-off by ticket instruction, still open')
  // (9) reviewer says needs-owner with no Question section
  const d9 = decide(plan, fx('pass.verdict.md').replace('\ngo\n', '\nneeds-owner\n').replace(/- 7: PASS[^\n]*/, '- 7: FAIL — design sign-off pending by ticket instruction'))
  assert.equal(d9.ok, true)
  assert.equal(d9.verdict, 'needs-owner')
  assert.equal(d9.question, SIGNOFF_QUESTION)
  assert.equal(d9.items['7'].pass, false)
  // (10) a lenient reviewer saying go with every item PASS is still a hold
  const d10 = decide(plan, fx('pass.verdict.md'))
  assert.equal(d10.ok, true)
  assert.equal(d10.verdict, 'needs-owner')
  // (11) 7 FAIL and 4 FAIL → still a hold, never a no-go marker
  const d11 = decide(plan, fx('pass.verdict.md').replace('\ngo\n', '\nno-go\n').replace(/- 4: PASS[^\n]*/, '- 4: FAIL — over-built').replace(/- 7: PASS[^\n]*/, '- 7: FAIL — design sign-off pending by ticket instruction'))
  assert.equal(d11.verdict, 'needs-owner')
  const c = renderComment(d11, { round: 2 })
  assert.match(c, /<!-- plan-review-verdict:needs-owner -->/)
  assert.ok(c.includes(SIGNOFF_QUESTION))
  assert.doesNotMatch(c, /plan-review-verdict:no-go/)
  // (12) controls
  assert.equal(decide(fx('clean.plan.md'), fx('owner.verdict.md')).question.startsWith('Drop the legacy'), true)
  assert.equal(decide(fx('clean.plan.md'), fx('pass.verdict.md')).verdict, 'go')
})

test('a plan with no ### Docs fails item 1 as malformed', () => {
  const plan = fx('clean.plan.md').replace(/### Docs\n[\s\S]*?(?=### Needs owner)/, '')
  assert.ok(!/### Docs/.test(plan))
  const r = precheck(plan)['1']
  assert.equal(r.pass, false)
  assert.match(r.evidence, /malformed.*Docs/)
  assert.equal(decide(plan, fx('pass.verdict.md')).verdict, 'no-go')
})

// covers: T5
test('#4082 an answered design sign-off ends the hold: Needs owner opening `no` ⇒ pendingSignoff false', async () => {
  const { pendingSignoff } = await import('./plan-verdict.mjs')
  const answered = fx('clean.plan.md').replace(/### Needs owner\n[^\n]*/, '### Needs owner\nno — the owner answered yes to the design sign-off (see ## Decisions)')
  assert.equal(pendingSignoff(answered), false)
  const open = fx('clean.plan.md').replace(/### Needs owner\n[^\n]*/, '### Needs owner\nyes — design sign-off')
  assert.equal(pendingSignoff(open), true)
})

const RECORD_LINE = /^<!-- reply-record:v1 .*-->$/
const withoutRecord = (c) => c.split('\n').filter((l) => !RECORD_LINE.test(l)).join('\n')
const countRecords = (c) => c.split('reply-record:v1').length - 1

// covers: T5 (#4113)
test('#4113 a needs-owner hold carries one plan-question record on line 3; needsOwnerQuestion still reads it', () => {
  const d = decide(fx('clean.plan.md'), fx('owner.verdict.md'))
  const body = renderComment(d)
  assert.deepEqual(readRecord(body), QUESTION_RECORD(d.question))
  assert.equal(readRecord(body).kind, 'plan-question')
  assert.equal(countRecords(body), 1)
  assert.match(body.split('\n')[2], RECORD_LINE)
  assert.match(body.split('\n')[3], /^> 🤖 \*\*pi\.dev harness\*\*/)
  assert.ok(needsOwnerQuestion([{ userType: 'Bot', body }]).startsWith('Drop the legacy'))
})

// covers: T6 (#4113)
test('#4113 only the final no-go carries a plan-rejected record; round-1 no-go and go carry none, visible text unchanged', () => {
  const j = decide(fx('contradicts-record.plan.md'), fx('contradicts-record.verdict.md'))
  const final = renderComment(j, { round: 2 })
  assert.match(final, /Held for you/)
  assert.deepEqual(readRecord(final), REJECTED_RECORD)
  assert.deepEqual(readRecord(final), {
    kind: 'plan-rejected',
    question: 'override the plan review?',
    accepts: ['ok: <reason>', 'approval', 'other'],
    starts: { 'ok: <reason>': 'approve-plan', approval: 'plan-needs-reason', other: 'replan-with-feedback' },
  })
  assert.equal(countRecords(final), 1)
  assert.match(final.split('\n')[2], RECORD_LINE)
  const lines = withoutRecord(final).split('\n')
  assert.deepEqual(lines.slice(0, 2), ['<!-- plan-review:v1 -->', '<!-- plan-review-verdict:no-go -->'])
  assert.match(lines[2], /^> 🤖 /)
  const r1 = renderComment(j, { round: 1 })
  assert.match(r1, /Plan sent back/)
  assert.equal(countRecords(r1), 0)
  assert.equal(readRecord(r1), null)
  const go = renderComment(decide(fx('clean.plan.md'), fx('pass.verdict.md')), { model: 'x' })
  assert.equal(countRecords(go), 0)
  assert.equal(readRecord(go), null)
  assert.equal(withoutRecord(r1), r1)
})

// covers: T7 (#4113)
test('#4113 a pending design sign-off hold carries the plan-question record with SIGNOFF_QUESTION', () => {
  const plan = fx('clean.plan.md').replace(/### Needs owner\n[^\n]*/, '### Needs owner\nyes — design sign-off by ticket instruction, still open')
  const d = decide(plan, fx('pass.verdict.md'))
  assert.equal(d.question, SIGNOFF_QUESTION)
  const body = renderComment(d, { round: 2 })
  const rec = readRecord(body)
  assert.equal(rec.kind, 'plan-question')
  assert.equal(rec.question, SIGNOFF_QUESTION)
  assert.deepEqual(rec, QUESTION_RECORD(SIGNOFF_QUESTION))
  assert.equal(countRecords(body), 1)
})
