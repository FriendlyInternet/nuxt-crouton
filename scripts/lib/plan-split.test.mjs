// #4184 T2 — the follow-up ticket a plan's `### Split` files: body + labels (pure core).
//   node --test scripts/lib/plan-split.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitBody, splitLabels, SPLIT_MARKER, NOTE_MARKER } from './plan-split.mjs'
import { parsePipelineBlock } from '../pipeline-context.mjs'
import { parsePlan } from './plan-shape.mjs'

const ORIGINAL = [
  '## Hypothesis', 'We think…', '',
  '## 👤 For humans', 'Sign in with the new OAuth button.', 'The 7 e2e tests prove the flow in a real browser.', '',
  '## 🤖 For agents', '1. add the endpoint', '2. "7 e2e tests" on a new fixture', '',
  '## 🧪 How to test', '1. call the endpoint → 200', '2. run the 7 e2e tests → green (T4)', '',
  'Packages-approved: crouton-auth — the OAuth endpoint',
  '<!-- pipeline: epic=4095 depth=1 step=2 epic_branch=epic/4095-oauth dispatch=delegate -->',
].join('\n')
const SPLIT = { title: 'Browser tests for OAuth', moves: ['"7 e2e tests"'], tests: ['T4'], why: 'a new test app plus 7 browser tests' }
const make = (body = ORIGINAL) => splitBody({ original: { number: 4096, body }, split: SPLIT, planUrl: 'https://github.com/o/r/issues/4096#issuecomment-777', planId: 777 })

test('T2: the body carries the marker, the Split-from line, Blocked-by and the moved items', () => {
  const b = make()
  assert.ok(b.startsWith(SPLIT_MARKER(4096, 777) + '\n'))
  assert.match(b, /Split from #4096 by its plan \(https:\/\/github\.com\/o\/r\/issues\/4096#issuecomment-777\) — too big for one run: a new test app plus 7 browser tests/)
  assert.match(b, /^Blocked-by: #4096$/m)
  assert.match(b, /^Dedup-checked: split from #4096$/m)
  assert.match(b, /## 🤖 For agents[\s\S]*^- "7 e2e tests"$/m)
  // the original's For-humans / How-to-test lines that name a moved item (or a moved T-id) are copied
  assert.match(b, /## 👤 For humans\nThe 7 e2e tests prove the flow in a real browser\./)
  assert.ok(!b.includes('Sign in with the new OAuth button.'))
  assert.match(b, /## 🧪 How to test\n2\. run the 7 e2e tests → green \(T4\)/)
})

test('T2: exactly one pipeline block, with the original epic / epic_branch / step and dispatch=work-this', () => {
  const b = make()
  assert.equal((b.match(/<!--\s*pipeline:/g) || []).length, 1)
  const p = parsePipelineBlock(b)
  assert.equal(p.epic, 4095); assert.equal(p.epic_branch, 'epic/4095-oauth'); assert.equal(p.step, 2); assert.equal(p.dispatch, 'work-this')
  assert.equal(p.depth, null) // only epic, epic_branch, step and dispatch are carried
})

test('T2: Packages-approved is copied verbatim, and absent when the original has none', () => {
  assert.match(make(), /^Packages-approved: crouton-auth — the OAuth endpoint$/m)
  const bare = make(ORIGINAL.split('\n').filter((l) => !l.startsWith('Packages-approved:')).join('\n'))
  assert.ok(!/Packages-approved:/i.test(bare))
})

test('T2: an original with no pipeline block and no matching lines still gives a usable body', () => {
  const b = make('## 👤 For humans\nnothing related\n')
  const p = parsePipelineBlock(b)
  assert.equal(p.dispatch, 'work-this'); assert.equal(p.epic, null); assert.equal(p.step, undefined) // a null value is left out
  assert.match(b, /see the moved items above/)
  assert.match(b, /^Blocked-by: #4096$/m)
})

test('T2: labels keep only pkg:* / app:* / type:*', () => {
  const names = ['pkg:crouton-auth', 'app:velo', 'type:feat', 'plan:approved', 'work-this', 'status:blocked', 'handoff:pending', 'delegate', 'epic']
  assert.deepEqual(splitLabels(names), ['pkg:crouton-auth', 'app:velo', 'type:feat'])
  assert.deepEqual(splitLabels([{ name: 'type:fix' }, { name: 'status:in-progress' }]), ['type:fix'])
})

test('T2: the markers, and the new body is not itself mistaken for a plan', () => {
  assert.equal(SPLIT_MARKER(5, 777), '<!-- plan-split:v1 from #5 plan=777 -->')
  assert.equal(NOTE_MARKER(12), '<!-- plan-split-note:v1 #12 -->')
  assert.equal(parsePlan(make()).split, null)
})
