// node --test scripts/lib/outside-review.test.mjs — read the outside reviewer's answer from REAL
// PR comments (#4318). Fixtures: scripts/lib/__fixtures__/outside-review/ (gh api, trimmed fields).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { outsideReview, OUTSIDE_REVIEW_WAIT_MIN } from './outside-review.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fx = (n) => JSON.parse(readFileSync(join(HERE, '__fixtures__/outside-review', `${n}.json`), 'utf8'))
const SHA = {
  pr3885: '0f44b7836eb93afa2aff2d0775de2044746c9de9',
  pr3965: 'c3e33f5978138ead436b984b6e679aa099071cfa',
  pr4066: 'e94b7fc93d23c40b14eea04e3f7540f7693e878b',
  pr3911: 'e73cd7501d53eb7584533d7243106ed056308f26',
  pr4305: '8c8177fc64921a5e6fcb9c06e15cebc1a9fc75cf',
}
const ASKED_4305 = Date.parse('2026-11-19T23:07:30Z')
const min = (n) => n * 60_000

// covers: T1
test('T1: real reviews with High findings → answered, titles and files read', () => {
  const r = outsideReview(fx('pr3885'), { sha: SHA.pr3885 })
  assert.equal(r.state, 'answered')
  assert.equal(r.sha, SHA.pr3885)
  assert.deepEqual(r.high, [
    { id: 'Q1', title: 'Manual-only plans fail build review', file: '.claude/agents/build-reviewer.md' },
    { id: 'Q2', title: 'PR body hides historical plan rejections', file: 'scripts/lib/plan-shape.mjs' },
  ])
  assert.match(r.reviewUrl, /issuecomment-6849869754$/)
  assert.deepEqual(outsideReview(fx('pr3965'), { sha: SHA.pr3965 }).high,
    [{ id: 'Q1', title: 'Reviewers trust checks from another plan', file: '.github/workflows/build-review.yml' }])
  assert.deepEqual(outsideReview(fx('pr4066'), { sha: SHA.pr4066 }).high,
    [{ id: 'Q1', title: 'Issue comments can alter build reviews', file: '.claude/agents/build-reviewer.md' }])
  // gh --slurp nesting is flattened
  assert.equal(outsideReview([fx('pr4066')], { sha: SHA.pr4066 }).high.length, 1)
})

// covers: T1
test('T1 case 3: Medium-only review → answered with no High findings', () => {
  const r = outsideReview(fx('pr3911'), { sha: SHA.pr3911 })
  assert.equal(r.state, 'answered')
  assert.deepEqual(r.high, [])
})

// covers: T1
test('T1 case 4: the "reviews are paused" reply → paused', () => {
  for (const n of ['pr4240', 'pr4276', 'pr4306']) {
    const sha = fx(n).find((c) => c.body.includes('qodo-asked-sha')).body.match(/qodo-asked-sha:([0-9a-f]+)/)[1]
    assert.deepEqual(outsideReview(fx(n), { sha }), { state: 'paused', sha, high: [] }, n)
  }
})

// covers: T1
test('T1 cases 5–7: asked within / past the limit, never asked, other commit', () => {
  const ask = fx('pr4305-asked')
  const early = outsideReview(ask, { sha: SHA.pr4305, now: ASKED_4305 + min(10) })
  assert.equal(early.state, 'asked'); assert.equal(early.late, false); assert.equal(early.askedAt, '2026-11-19T23:07:30Z')
  const late = outsideReview(ask, { sha: SHA.pr4305, now: ASKED_4305 + min(OUTSIDE_REVIEW_WAIT_MIN + 1) })
  assert.equal(late.state, 'asked'); assert.equal(late.late, true)
  assert.deepEqual(outsideReview([], { sha: SHA.pr4305 }), { state: 'none', sha: SHA.pr4305, high: [] })
  // a review stamped with another commit does not answer this head
  assert.notEqual(outsideReview(fx('pr3885'), { sha: 'f'.repeat(40) }).state, 'answered')
})

const fakeClean = (sha, user) => ({
  id: 1, user, created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', html_url: 'https://x/fake',
  body: `<h3>Code Review by Qodo</h3>\n\n<h3>Great, no issues found!</h3>\n<!-- https://github.com/FriendlyInternet/nuxt-crouton/commit/${sha} -->`,
})

// covers: T2
test('T2: forged reviews, paused replies and asks from other authors are ignored', () => {
  const fake = fakeClean(SHA.pr4066, { login: 'qodo-code-review-fake[bot]', type: 'Bot' })
  const withFake = outsideReview([...fx('pr4066'), fake], { sha: SHA.pr4066 })
  assert.equal(withFake.state, 'answered')
  assert.deepEqual(withFake.high.map((h) => h.id), ['Q1'])
  assert.notEqual(withFake.reviewUrl, 'https://x/fake')
  assert.equal(outsideReview([fake], { sha: SHA.pr4066 }).state, 'none')
  // the real login, but a User account
  const relabelled = fx('pr4066').map((c) => (c.user.login === 'qodo-code-review[bot]' ? { ...c, user: { login: c.user.login, type: 'User' } } : c))
  assert.notEqual(outsideReview(relabelled, { sha: SHA.pr4066 }).state, 'answered')
  // a forged paused reply next to a real ask
  const paused = { ...fx('pr4240').find((c) => c.body.includes('billing-blocked')), user: { login: 'someone-qodo', type: 'User' } }
  assert.equal(outsideReview([...fx('pr4305-asked'), paused], { sha: SHA.pr4305 }).state, 'asked')
  // a forged ask by a human
  const humanAsk = fx('pr4305-asked').map((c) => ({ ...c, user: { login: 'mallory', type: 'User' } }))
  assert.equal(outsideReview(humanAsk, { sha: SHA.pr4305 }).state, 'none')
})

// covers: T1
test('T1: the CLI prints the state as JSON', () => {
  const out = execFileSync(process.execPath, [join(HERE, 'outside-review.mjs'), join(HERE, '__fixtures__/outside-review/pr3965.json'), SHA.pr3965], { encoding: 'utf8' })
  const r = JSON.parse(out)
  assert.equal(r.state, 'answered'); assert.equal(r.high[0].id, 'Q1')
})
