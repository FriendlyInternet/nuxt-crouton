import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tick, parse, render, marker } from './flow-checklist.mjs'

test('first tick creates the checklist with marker', () => {
  const b = tick('', 7, 'routed', { note: 'plan', link: 'http://x' })
  assert.ok(b.includes(marker(7)))
  assert.match(b, /- \[x\] Routed — plan · http:\/\/x/)
  assert.match(b, /- \[ \] Plan \+ mockup posted/)
})

test('second tick edits state, keeps earlier ticks', () => {
  const b1 = tick('', 7, 'routed', { note: 'plan' })
  const b2 = tick(b1, 7, 'plan', { link: 'http://p' })
  assert.deepEqual(Object.keys(parse(b2)), ['routed', 'plan'])
  assert.equal(b2.split(marker(7)).length, 2)
})

test('unknown step throws', () => {
  assert.throws(() => tick('', 7, 'nope'))
})

test('render with empty state ticks nothing', () => {
  assert.ok(!render(1, {}).includes('[x]'))
})

import { readFileSync } from 'node:fs'
import { STEPS, issueFromPrBody } from './flow-checklist.mjs'

test('every step ticks, keeps the others, and the full flow ends all-ticked', () => {
  let b = ''
  for (const [key] of STEPS) {
    b = tick(b, 9, key, { link: `http://l/${key}` })
    assert.ok(key in parse(b), `${key} ticked`)
  }
  assert.equal(Object.keys(parse(b)).length, STEPS.length)
  assert.ok(!b.includes('[ ]'))
  assert.equal(b.split(marker(9)).length, 2)
})

test('ticking the same step twice updates it, not duplicates it', () => {
  const b = tick(tick('', 9, 'review', { note: 'no-go (round 1)' }), 9, 'review', { note: 'go (round 2)' })
  assert.match(b, /- \[x\] Build review — go \(round 2\)/)
  assert.equal((b.match(/Build review/g) || []).length, 1)
})

test('issueFromPrBody reads the Closes line', () => {
  assert.equal(issueFromPrBody('Closes #3210\n\nx'), 3210)
  assert.equal(issueFromPrBody('no link'), null)
})

// Wiring: each step is ticked from the workflow that owns its event (#3210).
const wf = f => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8')
for (const [file, step] of [
  ['work-issue-pidev.yml', 'routed'],
  ['work-issue-pidev.yml', 'plan'],
  ['plan-approved.yml', 'ok'],
  ['work-issue-pidev.yml', 'pr'],
  ['build-review.yml', 'review'],
  ['automerge-epic-subpr.yml', 'merged']
]) {
  test(`${file} ticks "${step}"`, () => {
    assert.match(wf(file), new RegExp(`flow-checklist\\.mjs[^\\n]*(\\n[^\\n]*)?[ "']${step}\\b`))
  })
}

// The rule itself: one comment per ticket, edited in place (#3210).
import { apply } from './flow-checklist.mjs'
function fakeGh(initial = []) {
  const comments = [...initial], calls = []
  const run = (args, input) => {
    calls.push(args)
    if (args.includes('PATCH') || args.includes('-X')) {
      const id = Number(args[3].split('/').pop()); comments.find(c => c.id === id).body = input; return ''
    }
    if (args[1].includes('?per_page')) return JSON.stringify([comments])
    comments.push({ id: comments.length + 1, body: input, user: { type: 'Bot' } }); return ''
  }
  return { run, comments, calls }
}

test('apply: first tick posts one comment, later ticks edit that same one', () => {
  const g = fakeGh()
  assert.equal(apply({ repo: 'o/r', issue: 5, step: 'routed', note: 'plan (why)', run: g.run }), 'created')
  assert.equal(apply({ repo: 'o/r', issue: 5, step: 'plan', run: g.run }), 'edited')
  assert.equal(apply({ repo: 'o/r', issue: 5, step: 'ok', run: g.run }), 'edited')
  assert.equal(g.comments.length, 1)
  assert.deepEqual(Object.keys(parse(g.comments[0].body)), ['routed', 'plan', 'ok'])
})

test('apply: a human comment quoting the marker is not mistaken for ours', () => {
  const g = fakeGh([{ id: 1, body: `${marker(5)} hi`, user: { type: 'User' } }])
  assert.equal(apply({ repo: 'o/r', issue: 5, step: 'routed', run: g.run }), 'created')
  assert.equal(g.comments.length, 2)
})

test('run-name carries the issue number', () => {
  assert.match(wf('work-issue-pidev.yml'), /^run-name: .*inputs\.issue/m)
  assert.match(wf('decompose-on-issue-pidev.yml'), /^run-name: .*issue/m)
})
