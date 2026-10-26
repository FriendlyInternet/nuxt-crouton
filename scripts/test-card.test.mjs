// The test-card decision + text (#2541). A false POST pings the owner to test something not live.
//   node --test scripts/test-card.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTestCard, buildCard, extractChecks, CARD_MARKER } from './test-card.mjs'

const C = { state: 'closed' }
const base = { subIssues: [C, C], labels: ['epic'], comments: [], deployed: true }

test('posts when all children closed and deployed', () => {
  assert.equal(decideTestCard(base).post, true)
})
test('skips while a child is open', () => {
  assert.equal(decideTestCard({ ...base, subIssues: [C, { state: 'open' }] }).post, false)
})
test('skips when not deployed yet', () => {
  assert.match(decideTestCard({ ...base, deployed: false }).reason, /staging/)
})
test('skips an epic with no children', () => {
  assert.equal(decideTestCard({ ...base, subIssues: [] }).post, false)
})
test('idempotent: marker comment or label stops a second card', () => {
  assert.equal(decideTestCard({ ...base, comments: [{ body: `x ${CARD_MARKER}` }] }).post, false)
  assert.equal(decideTestCard({ ...base, labels: ['status:to-test'] }).post, false)
  assert.equal(decideTestCard({ ...base, labels: ['status:verified'] }).post, false)
})
test('extractChecks reads the Done when section, max 3', () => {
  const body = '## Do\n- x\n\n## Done when\n- a\n- b\n- c\n- d\n\n---\nfooter'
  assert.deepEqual(extractChecks(body), ['a', 'b', 'c'])
  assert.deepEqual(extractChecks('no section'), [])
})
test('buildCard has marker, account, checks, reply line, no password', () => {
  const t = buildCard({ epicNumber: 1, title: 'T', app: 'velo', stagingUrl: 'https://v', reviewAccount: 'r@x', checks: ['a', 'b'] })
  assert.ok(t.startsWith(CARD_MARKER))
  assert.match(t, /Log in as:\*\* r@x/)
  assert.equal((t.match(/- Check:/g) || []).length, 2)
  assert.match(t, /not ok: <what is wrong>/)
  assert.doesNotMatch(t, /password:/i)
})
