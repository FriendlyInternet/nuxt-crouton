// layer: stack
// A hold must not send the owner to a dead PR (#2111). The rule: in an ASKING brief, every PR the
// `You:` line points at must be open. Numbers outside that line are context, and Done briefs ask
// nothing — neither is checked.
//   node --test scripts/review-target.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewTargets, judgeTargets, checkReviewTargets, explainStale, ghLookup } from './review-target.mjs'
import { BRIEF_TYPES } from './owner-brief.mjs'

const HEAD = '> 🤖 **Claude Code** · interactive agent · posted from `@pmcp`\'s account (not Maarten) · _ctx_\n\n'
// The brief marker is whatever owner-brief reads (emoji since #2539) — use its own table, so a
// future format change moves these tests with it instead of silently matching nothing.
const MARK = Object.fromEntries(BRIEF_TYPES.map(t => [t.name, t.emoji]))
const brief = (type, you, rest = '') => `${HEAD}${MARK[type]} **headline.**\n\n**You:** ${you}\n**Depth:** link${rest}`

test('targets come from the You: line of an asking brief — #N and /pull/N', () => {
  assert.deepEqual(reviewTargets(brief('Review', 'approve #2500 or open https://github.com/o/r/pull/2496')), [2500, 2496])
})

test('numbers outside the You: line are context, not targets', () => {
  assert.deepEqual(reviewTargets(brief('Action', 'merge #2502', '\n\nThis replaces #2039, which merged.')), [2502])
})

test('a Done brief asks nothing — no targets even if it names PRs', () => {
  assert.deepEqual(reviewTargets(brief('Done', 'nothing — #2495 merged')), [])
})

test('a literal Review brief, written as an agent would post it', () => {
  assert.deepEqual(reviewTargets(`> 🤖 x\n\n👀 **Review this.**\n\n**You:** approve #12\n`), [12])
})

test('code spans, <details>, and anchors like &#39; are not targets', () => {
  const b = brief('Choice', 'reply `#99` or B &#39;x&#39;', '\n<details>\n\n**You:** #77\n</details>')
  assert.deepEqual(reviewTargets(b), [])
})

test('no brief type → nothing to check (owner-brief refuses it separately)', () => {
  assert.deepEqual(reviewTargets('**You:** look at #5'), [])
})

test('judge: merged or closed PR is stale; open PR, issue, failed lookup pass', () => {
  const v = judgeTargets([
    { number: 1, kind: 'pr', state: 'open', merged: false },
    { number: 2, kind: 'pr', state: 'closed', merged: true },
    { number: 3, kind: 'pr', state: 'closed', merged: false },
    { number: 4, kind: 'issue' },
    { number: 5, kind: 'unknown' },
  ])
  assert.equal(v.ok, false)
  assert.deepEqual(v.stale, [{ number: 2, why: 'merged' }, { number: 3, why: 'closed' }])
})

test('the #2039 case: a Review pointing at a merged PR is refused, with a plain reason', () => {
  const lookup = n => ({ number: n, kind: 'pr', state: 'closed', merged: true })
  const v = checkReviewTargets(brief('Review', 'pin your comment on #2039'), { lookup })
  assert.equal(v.ok, false)
  assert.match(explainStale(v.stale), /#2039 is already merged/)
})

test('an open PR passes; lookups are only made for the You: targets', () => {
  const seen = []
  const lookup = n => { seen.push(n); return { number: n, kind: 'pr', state: 'open', merged: false } }
  assert.equal(checkReviewTargets(brief('Review', 'approve #2500', '\n\nafter #2039'), { lookup }).ok, true)
  assert.deepEqual(seen, [2500])
})

test('ghLookup: 404 → issue, other errors → unknown (fail open), success → pr state', () => {
  const fail = msg => () => { const e = new Error('x'); e.stderr = msg; throw e }
  assert.equal(ghLookup(7, { exec: fail('gh: Not Found (HTTP 404)') }).kind, 'issue')
  assert.equal(ghLookup(7, { exec: fail('connection reset') }).kind, 'unknown')
  assert.deepEqual(ghLookup(7, { exec: () => '{"state":"closed","merged":true}' }),
    { number: 7, kind: 'pr', state: 'closed', merged: true })
})
