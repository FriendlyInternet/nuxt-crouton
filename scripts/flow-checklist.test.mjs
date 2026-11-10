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
// automerge's merge call (and its tick) moved into scripts/lib/v1-merge-io.mjs (#3501).
const wf = f => readFileSync(new URL(f.endsWith('.mjs') ? `./lib/${f}` : `../.github/workflows/${f}`, import.meta.url), 'utf8')
for (const [file, step] of [
  ['work-issue-pidev.yml', 'routed'],
  ['work-issue-pidev.yml', 'plan'],
  ['on-comment.yml', 'ok'],
  ['work-issue-pidev.yml', 'pr'],
  ['build-review.yml', 'review'],
  ['automerge-epic-subpr.yml', 'merged'],
  ['v1-merge-io.mjs', 'merged']
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

test('"Owner ok" is ticked only from a real owner approval, never the plan:approved label (#3210)', () => {
  // automerge's merge call (and its tick) moved into scripts/lib/v1-merge-io.mjs (#3501).
const wf = f => readFileSync(new URL(f.endsWith('.mjs') ? `./lib/${f}` : `../.github/workflows/${f}`, import.meta.url), 'utf8')
  assert.ok(!/flow-checklist\.mjs[^\n]*\bok\b/.test(wf('label-router.yml')), 'label-router.yml must not tick ok')
  const oc = wf('on-comment.yml')
  assert.ok(oc.indexOf("'ok', '--link'") > oc.indexOf('isApproval(body)'), 'ok tick sits after the isApproval check')
})

// ── review verdicts in the checklist (#3565) ──
import { review, reviewLine, sentToOwner } from './flow-checklist.mjs'
import { spawnSync } from 'node:child_process'

const TODAY_EMPTY = '<!-- flow-checklist:7 -->\n> 🤖 **pi.dev harness** · ticket flow · _edited in place_\n\n- [ ] Routed\n- [ ] Plan + mockup posted\n- [ ] Owner ok\n- [ ] Build PR opened\n- [ ] Build review\n- [ ] Merged'

test('no verdict → output byte-identical to today', () => {
  assert.equal(render(7, {}), TODAY_EMPTY)
  assert.equal(tick('', 7, 'routed', { note: 'plan', link: 'http://x' }), TODAY_EMPTY.replace('- [ ] Routed', '- [x] Routed — plan · http://x'))
})

test('plan verdict then build verdict → both lines', () => {
  const b = review(review('', 7, 'plan', 'go', 1, { link: 'L1' }), 7, 'build', 'no-go', 2, { link: 'L2' })
  assert.ok(b.includes('**Latest reviews**\n- Plan review — go (round 1) · L1\n- Build review — no-go (round 2) · sent to you · L2\n\n- [ ] Routed'))
})

test('newer build verdict replaces older, plan line kept', () => {
  let b = review('', 7, 'plan', 'go', 1)
  b = review(b, 7, 'build', 'no-go', 1)
  b = review(b, 7, 'build', 'go', 2)
  assert.equal(b.match(/^- Build review — .*$/gm).length, 1)
  assert.match(b, /^- Build review — go \(round 2\)$/m)
  assert.match(b, /^- Plan review — go \(round 1\)$/m)
})

test('parse(render(x)) round-trips steps and verdicts', () => {
  let b = tick('', 7, 'routed', { note: 'plan' })
  b = review(b, 7, 'plan', 'go', 1, { link: 'P' })
  b = review(tick(b, 7, 'review', { note: 'x' }), 7, 'build', 'needs-owner', 1)
  assert.deepEqual(parse(render(7, parse(b))), parse(b))
  assert.equal(render(7, parse(b)), b)
})

test('sentToOwner table', () => {
  for (const a of [['build', 'needs-owner', 1], ['build', 'no-go', 2], ['plan', 'needs-owner', 1], ['plan', 'no-go', 1, 'hold']]) assert.equal(sentToOwner(...a), true, a.join())
  for (const a of [['build', 'go', 2], ['build', 'no-go', 1], ['plan', 'go', 1], ['plan', 'no-go', 1, 'retry'], ['plan', 'no-go', 1]]) assert.equal(sentToOwner(...a), false, a.join())
  assert.throws(() => reviewLine('x', 'go', 1))
  assert.throws(() => reviewLine('plan', 'maybe', 1))
  assert.throws(() => reviewLine('plan', 'go', 'a'))
})

test('verdict-only call with no checklist comment creates nothing', () => {
  const g = fakeGh()
  assert.equal(apply({ repo: 'o/r', issue: 5, verdict: { kind: 'plan', verdict: 'go', round: 1 }, createIfMissing: false, run: g.run }), 'skipped')
  assert.equal(g.comments.length, 0)
  assert.equal(g.calls.length, 1)
})

test('verdict-only call edits the existing comment, ticks + links untouched', () => {
  const g = fakeGh()
  apply({ repo: 'o/r', issue: 5, step: 'routed', link: 'http://r', run: g.run })
  apply({ repo: 'o/r', issue: 5, step: 'plan', link: 'http://p', run: g.run })
  assert.equal(apply({ repo: 'o/r', issue: 5, verdict: { kind: 'plan', verdict: 'go', round: 1 }, createIfMissing: false, run: g.run }), 'edited')
  assert.equal(g.comments.length, 1)
  assert.match(g.comments[0].body, /^- \[x\] Routed — http:\/\/r$/m)
  assert.match(g.comments[0].body, /^- \[x\] Plan \+ mockup posted — http:\/\/p$/m)
  assert.match(g.comments[0].body, /\*\*Latest reviews\*\*/)
})

test('later ticks keep the reviews block', () => {
  const b = review('', 7, 'build', 'go', 1, { link: 'L' })
  const slice = s => s.slice(s.indexOf('**Latest reviews**'), s.indexOf('- [')) 
  const b2 = tick(tick(b, 7, 'pr', { link: 'P' }), 7, 'merged', {})
  assert.equal(slice(b2), slice(b))
})

test('on-comment.yml (plan review) makes a verdict-only call before the case', () => {
  const w = wf('on-comment.yml')
  assert.match(w, /flow-checklist\.mjs "\$ISSUE" --verdict plan /)
  assert.ok(w.indexOf('flow-checklist.mjs "$ISSUE" --verdict plan') < w.indexOf('case "$VERDICT" in'))
})

test('build-review.yml passes --verdict build on the review tick line', () => {
  assert.match(wf('build-review.yml'), /flow-checklist\.mjs" "\$ISSUE" review [^\n]*--verdict build/)
})

test('CLI with no step and no --verdict exits 2', () => {
  assert.equal(spawnSync('node', ['scripts/flow-checklist.mjs', '5']).status, 2)
})
