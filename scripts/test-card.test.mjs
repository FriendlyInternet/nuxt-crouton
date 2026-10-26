// The test-card decision + text (#2541). A false POST pings the owner to test something not live.
//   node --test scripts/test-card.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTestCard, buildCard, buildTestMail, extractChecks, CARD_MARKER } from './test-card.mjs'

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

test('buildTestMail: app first, numbered steps, sign-in link, no emoji', async () => {
  const { buildTestMail, extractSummary } = await import('./test-card.mjs')
  const m = buildTestMail({ epicNumber: 1, title: 'bookings calendar swipe', app: 'Velo', summary: 'You can swipe.', checks: ['Go to Bookings.'], loginUrl: 'https://x/auth/login?a=b', epicUrl: 'https://gh/1' })
  assert.equal(m.subject, '[Velo] Test: bookings calendar swipe')
  assert.match(m.text, /^App: Velo \(staging\)\n/)
  assert.match(m.text, /1\. Open the link below and sign in\.\n2\. Go to Bookings\./)
  assert.match(m.text, /Open and sign in: https:\/\/x\/auth\/login/)
  assert.equal(extractSummary('Part of #1.\n\n## Problem\n\nFirst para\nwraps.\n\nSecond'), 'First para wraps.')
})

test('extractChecks: How to test wins over Done when, metadata dropped, bold stripped', () => {
  const body = '## Done when\n- worker a\n\n## 🧪 How to test\n1. **Open the list**\n2. Blocked-by: #2509\n3. Closes #5\n<!-- c -->\n- See the badge\n\nDedup-checked: x'
  assert.deepEqual(extractChecks(body), ['Open the list', 'See the badge'])
  assert.deepEqual(extractChecks('### How to test\n- one'), ['one'])
  assert.deepEqual(extractChecks('## Done when\n- Blocked-by: #1\n- real'), ['real'])
})
test('no-app card and mail print no placeholder text', async () => {
  const { buildTestMail } = await import('./test-card.mjs')
  const c = buildCard({ epicNumber: 1, title: 'T', checks: ['a'] })
  assert.match(c, /Nothing to open: this changes how GitHub and the pipeline behave\. Check it on the epic itself\./)
  assert.doesNotMatch(c, /see epic|staging URL not configured|Log in as/)
  const m = buildTestMail({ epicNumber: 1, title: 'T', checks: ['a'] })
  assert.match(m.text, /Nothing to open/)
  assert.doesNotMatch(m.text, /see epic|sign in/i)
})
test('app without staging url says so', () => {
  assert.match(buildCard({ epicNumber: 1, title: 'T', app: 'velo' }), /App:\*\* velo — no staging link yet/)
})

test('bold markers inside a step are dropped; no-app mail subject has no placeholder', () => {
  const body = '## How to test\n1. **Expect** the list\n'
  assert.deepEqual(extractChecks(body), ['Expect the list'])
  assert.equal(buildTestMail({ epicNumber: 5, title: 'Flow' }).subject, 'Test: Flow')
})
