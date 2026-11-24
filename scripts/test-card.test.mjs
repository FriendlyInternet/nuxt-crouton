// The test-card decision + text (#2541). A false POST pings the owner to test something not live.
//   node --test scripts/test-card.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTestCard, buildCard, buildTestMail, extractChecks, hasTestSteps, howToTestPointer, CARD_MARKER, appsFromJobs, decideAppNotice, BROKEN_NOTICE, BACKUP_NOTICE, NOT_CHECKED_LINE } from './test-card.mjs'

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
test('extractChecks reads the Done when section, max 5', () => {
  const body = '## Do\n- x\n\n## Done when\n- a\n- b\n- c\n- d\n\n---\nfooter'
  assert.deepEqual(extractChecks(body), ['a', 'b', 'c', 'd'])
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

test('hasTestSteps: only a How to test section counts, not Done when', () => {
  assert.equal(hasTestSteps('## 🧪 How to test\n1. Open it\n2. Click'), true)
  assert.equal(hasTestSteps('## Done when\n- it works'), false)
  assert.equal(hasTestSteps('## 🧪 How to test\n\nDedup-checked: x'), false)
  assert.equal(hasTestSteps('no section'), false)
})

import { deriveApps } from './test-card.mjs'
test('extractChecks keeps a 4-step How to test (max 5)', () => {
  assert.equal(extractChecks('## 🧪 How to test\n1. a\n2. b\n3. c\n4. d\n').length, 4)
})
test('deriveApps: app from changed files, lockfile ignored, tie broken by text', () => {
  const apps = [
    { app: 'velo', watchPaths: ['apps/velo/**', 'pnpm-lock.yaml', 'packages/crouton-core/**'] },
    { app: 'kassa', watchPaths: ['apps/kassa/**', 'pnpm-lock.yaml', 'packages/crouton-core/**'] }
  ]
  assert.deepEqual(deriveApps({ changedFiles: ['apps/velo/a.vue'], apps }), ['velo'])
  assert.deepEqual(deriveApps({ changedFiles: ['pnpm-lock.yaml'], apps }), [])
  assert.deepEqual(deriveApps({ changedFiles: ['.github/x.yml'], apps }), [])
  assert.deepEqual(deriveApps({ changedFiles: ['packages/crouton-core/a.ts'], apps }), ['velo', 'kassa'])
  assert.deepEqual(deriveApps({ changedFiles: ['packages/crouton-core/a.ts'], apps, text: 'Open Kassa and pay' }), ['kassa'])
})

test('card says saving was not checked only when the app has no smoke.crud', () => {
  assert.match(buildCard({ epicNumber: 1, app: 'Gallery', crudChecked: false }), new RegExp(NOT_CHECKED_LINE))
  assert.doesNotMatch(buildCard({ epicNumber: 1, app: 'Velo', crudChecked: true }), new RegExp(NOT_CHECKED_LINE))
  assert.doesNotMatch(buildCard({ epicNumber: 1 }), new RegExp(NOT_CHECKED_LINE))
})
test('appsFromJobs matches whole app ids by conclusion', () => {
  const jobs = [{ name: 'deploy (velo, staging)', conclusion: 'failure' }, { name: 'deploy (kassa, staging)', conclusion: 'success' }]
  assert.deepEqual(appsFromJobs(jobs, ['velo', 'kassa', 'vel'], 'failure'), ['velo'])
  assert.deepEqual(appsFromJobs(jobs, ['velo', 'kassa'], 'success'), ['kassa'])
})
test('broken notice posts once; back-up notice only after a broken one', () => {
  assert.equal(decideAppNotice({ kind: 'broken', comments: [] }).body, BROKEN_NOTICE)
  const afterBroken = [{ body: BROKEN_NOTICE }]
  assert.equal(decideAppNotice({ kind: 'broken', comments: afterBroken }).post, false)
  assert.equal(decideAppNotice({ kind: 'back', comments: [] }).post, false)
  assert.equal(decideAppNotice({ kind: 'back', comments: afterBroken }).body, BACKUP_NOTICE)
  assert.equal(decideAppNotice({ kind: 'back', comments: [...afterBroken, { body: BACKUP_NOTICE }] }).post, false)
  assert.equal(decideAppNotice({ kind: 'broken', comments: [...afterBroken, { body: BACKUP_NOTICE }] }).post, true)
})

test("howToTestPointer points at the issue's steps, or says there are none", () => {
  assert.equal(howToTestPointer(2829, '## 🧪 How to test\n1. Open the page\n2. Tap save\n'), 'How to test: see #2829 → 🧪')
  assert.equal(howToTestPointer(2829, '## Done when\n- it works\n'), 'How to test: #2829 has no 🧪 steps')
  assert.equal(howToTestPointer(2829, ''), 'How to test: #2829 has no 🧪 steps')
})

// #4039 — a fresh card after a `not ok` fix lands on staging (#2804 replay).
const oldCard = { body: `${CARD_MARKER}\n## 🧪 Test card`, created_at: '2026-10-29T09:49:02Z' }
const failed = { subIssues: [C, C, C, C], labels: ['epic', 'status:failed'], comments: [oldCard], deployed: false, fixClosedAt: '2026-11-12T12:18:13Z' }

test('T1: #2804 replay — fix deployed after not ok → fresh card', () => {
  const d = decideTestCard({ ...failed, fixDeployed: true })
  assert.equal(d.post, true)
  assert.equal(d.retest, true)
  assert.match(d.reason, /fresh card/)
})
test('T2: fix closed but not on staging yet → no card', () => {
  const d = decideTestCard({ ...failed, fixDeployed: false })
  assert.equal(d.post, false)
  assert.match(d.reason, /not on staging/)
})
test('T3: not ok fix child still open → no card', () => {
  const d = decideTestCard({ subIssues: [C, { state: 'open' }], labels: ['epic', 'status:failed'], comments: [], fixDeployed: true })
  assert.equal(d.post, false)
  assert.match(d.reason, /open/)
})
test('T4: verified stays answered, first card still posts, re-test line names the fix', () => {
  const v = decideTestCard({ ...base, labels: ['epic', 'status:verified'] })
  assert.equal(v.post, false)
  assert.equal(v.reason, 'already answered')
  assert.equal(decideTestCard({ subIssues: [C], labels: ['epic'], comments: [], deployed: true }).post, true)
  const card = buildCard({ epicNumber: 2804, title: 'T', fixIssue: 3046 })
  assert.ok(card.startsWith(CARD_MARKER))
  assert.match(card, /Re-test after the fix in #3046/)
  assert.doesNotMatch(buildCard({ epicNumber: 2804, title: 'T' }), /Re-test/)
})
test('T9: one fresh card per fix — status:to-test beats status:failed', () => {
  const d = decideTestCard({ ...failed, labels: ['epic', 'status:failed', 'status:to-test'], fixDeployed: true })
  assert.equal(d.post, false)
  assert.equal(d.reason, 'already status:to-test')
})
test('T10: one fresh card per fix — a card newer than the fix close stops a repeat', () => {
  const d = decideTestCard({ ...failed, comments: [oldCard, { body: CARD_MARKER, created_at: '2026-11-13T08:00:00Z' }], fixDeployed: true })
  assert.equal(d.post, false)
  assert.match(d.reason, /already posted for this fix/)
})

// ── Evidence: what the pipeline already checked (#3882) ──────────────────────────────
import { buildEvidence, closingNote, cleanNote, defangMentions, EVIDENCE_HEADING } from './test-card.mjs'

const appCard = { epicNumber: 1, title: 'X', app: 'velo', stagingUrl: 'https://velo.pmcp.dev', reviewAccount: 'r@x', checks: ['a', 'b'] }
const noAppCard = { epicNumber: 2, title: 'Y', checks: ['c'] }
const twoEntries = [{ title: 'A', url: 'https://a', note: 'note a' }, { title: 'B', url: 'https://b' }]

// covers: T1
test('evidence T1: no or empty evidence leaves the card byte-identical', () => {
  for (const input of [appCard, noAppCard]) {
    const before = buildCard(input)
    assert.equal(buildCard({ ...input, evidence: [] }), before)
    assert.ok(!before.includes('Already checked'))
  }
})

// covers: T2
test('evidence T2: two entries sit above the first Check line, in order', () => {
  const lines = buildCard({ ...appCard, evidence: twoEntries }).split('\n')
  const h = lines.indexOf(EVIDENCE_HEADING)
  const a = lines.indexOf('- [A](https://a) — note a')
  const b = lines.indexOf('- [B](https://b)')
  const check = lines.findIndex(l => l.startsWith('- Check:'))
  assert.ok(h >= 0 && h < a && a < b && b < check, lines.join('\n'))
})

// covers: T3
test('evidence T3: ten entries render 8 lines then "and 2 more"', () => {
  const ev = Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, url: `https://u/${i}` }))
  const lines = buildCard({ ...appCard, evidence: ev }).split('\n')
  assert.equal(lines.filter(l => l.startsWith('- [t')).length, 8)
  assert.ok(lines.includes('- and 2 more'))
})

// covers: T4
test('evidence T4: an @handle in a note is backticked in card and mail', () => {
  const ev = [{ title: 'A', url: 'https://a', note: 'thanks @someone' }]
  assert.equal(defangMentions('thanks @someone'), 'thanks `@someone`')
  for (const out of [buildCard({ ...appCard, evidence: ev }), buildTestMail({ ...appCard, evidence: ev }).text]) {
    assert.ok(out.includes('thanks `@someone`'))
    assert.ok(!/(?<![\w`])@someone/.test(out))
  }
})

// covers: T5
test('evidence T5: the mail lists evidence as plain text before "What to test:"', () => {
  const lines = buildTestMail({ ...appCard, evidence: twoEntries }).text.split('\n')
  const h = lines.indexOf('Already checked by the pipeline:')
  assert.equal(lines[h + 1], '- A: https://a — note a')
  assert.equal(lines[h + 2], '- B: https://b')
  assert.ok(h >= 0 && h < lines.indexOf('What to test:'))
  assert.ok(!lines.join('\n').includes(']('))
})

// covers: T6
test('evidence T6: buildEvidence maps completed children to their merged PR + note', () => {
  const child10 = { number: 10, title: 'child10', html_url: 'https://gh/issues/10', state: 'closed', state_reason: 'completed' }
  const child11 = { number: 11, title: 'child11', html_url: 'https://gh/issues/11', state: 'closed', state_reason: 'not_planned' }
  const child12 = { number: 12, title: 'child12', html_url: 'https://gh/issues/12', state: 'closed', state_reason: 'completed' }
  const pr20 = { number: 20, body: 'Closes #10', html_url: 'https://gh/pull/20', merged_at: '2026-11-01T00:00:00Z' }
  const commentsByIssue = {
    10: [
      { login: 'nuxt-harness[bot]', body: '<!-- pipeline-note -->\n> 🤖 …\n✅ **Built to the plan** — x', created_at: '2026-11-01T01:00:00Z' },
      { login: 'github-actions[bot]', body: '✅ **Resumed from your reply**', created_at: '2026-11-01T02:00:00Z' },
      { login: 'nuxt-harness[bot]', body: '<!-- plan-review:v1 -->\n✅ **Plan approved** — y', created_at: '2026-11-01T03:00:00Z' }
    ]
  }
  assert.deepEqual(buildEvidence({ subIssues: [child10, child11, child12], mergedPrs: [pr20], commentsByIssue }), [
    { title: 'child10', url: 'https://gh/pull/20', note: 'Built to the plan — x' },
    { title: 'child12', url: 'https://gh/issues/12', note: '' }
  ])
})

// covers: T7
test('evidence T7: closingNote reads real-shaped notes', () => {
  const bot = (body, at) => ({ login: 'nuxt-harness[bot]', body, created_at: at })
  assert.equal(closingNote([bot('> 🤖 x\n## ✅ Done — the loop is fixed\nmore', '2026-01-01T00:00:00Z')]), 'Done — the loop is fixed')
  assert.equal(closingNote([{ login: 'pmcp', body: '✅ **Closing as passed.** All rows passed', created_at: '2026-01-01T00:00:00Z' }]), 'Closing as passed. All rows passed')
  assert.equal(closingNote([
    bot('## ✅ Done — real', '2026-01-01T00:00:00Z'),
    bot('✅ **Built to the plan** — no action needed', '2026-01-02T00:00:00Z')
  ]), 'Done — real')
  assert.equal(closingNote([bot('<!-- plan-review:v1 -->\n✅ **Plan approved**', '2026-01-01T00:00:00Z')]), '')
})

// covers: T8
test('evidence T8: a note with password= never reaches the card or mail', () => {
  const leak = '✅ **Done** — sign in at https://x.pmcp.dev/login?email=a&password=abc'
  assert.equal(closingNote([{ login: 'pmcp', body: leak, created_at: '2026-01-01T00:00:00Z' }]), '')
  const ev = [{ title: 'A', url: 'https://a', note: 'see https://x/login?password=abc' }]
  assert.ok(!buildCard({ ...appCard, evidence: ev }).includes('password='))
  assert.ok(!buildTestMail({ ...appCard, evidence: ev }).text.includes('password='))
})

// covers: PR #4067 review — titles and code-span mentions
test('evidence T9: a title with a link breaker gives exactly one link, to the entry URL', () => {
  const ev = [{ title: 'x](https://example.org)', url: 'https://github.com/o/r/pull/1', note: '' }]
  const line = buildCard({ ...appCard, evidence: ev }).split('\n').find(l => l.startsWith('- ['))
  const links = [...line.matchAll(/(?<!\\)\]\(([^)]*)\)/g)].map(m => m[1])
  assert.deepEqual(links, ['https://github.com/o/r/pull/1'])
  assert.equal(line, '- [x\\](https://example.org)](https://github.com/o/r/pull/1)')
  const mail = buildTestMail({ ...appCard, evidence: ev }).text
  assert.ok(mail.includes('- x](https://example.org): https://github.com/o/r/pull/1'))
})

test('evidence T10: an @handle in a title is backticked in card and mail', () => {
  const ev = [{ title: 'Fix for @someone', url: 'https://a', note: '' }]
  for (const out of [buildCard({ ...appCard, evidence: ev }), buildTestMail({ ...appCard, evidence: ev }).text]) {
    assert.ok(out.includes('Fix for `@someone`'))
    assert.ok(!/(?<![\w`])@someone/.test(out))
  }
})

test('evidence T11: a handle right after a closing backtick is still backticked', () => {
  assert.equal(defangMentions('`x`@alice'), '`x``@alice`')
  const ev = [{ title: 'A', url: 'https://a', note: '`x`@alice' }]
  assert.ok(buildCard({ ...appCard, evidence: ev }).includes('— `x``@alice`'))
})

// covers: PR #4067 build review — a long note cut near a handle must still never ping
test('evidence T13: a long note with a handle near the 140-char cut never leaves a bare handle', () => {
  const body = `✅ Done ${'x'.repeat(120)} cc @alice-longhandle`
  const note = closingNote([{ login: 'pmcp', body, created_at: '2026-01-01T00:00:00Z' }])
  const bare = /(?<![\w`])@[A-Za-z0-9-]/
  const ticks = s => (s.match(/`/g) || []).length
  assert.ok(!bare.test(note), note)
  assert.equal(ticks(note) % 2, 0)
  const twice = cleanNote(note)
  assert.ok(!bare.test(twice) && ticks(twice) % 2 === 0, twice)
  const ev = [{ title: 'A', url: 'https://a', note }]
  for (const out of [buildCard({ ...appCard, evidence: ev }), buildTestMail({ ...appCard, evidence: ev }).text]) {
    const line = out.split('\n').find(l => l.includes('x'.repeat(120)))
    assert.ok(line && !bare.test(line), line)
    assert.equal(ticks(line) % 2, 0)
  }
  // a caller passing an already-defanged note that is longer than 140 must not break the span either
  const long = `${'y'.repeat(130)} cc \`@alice-longhandle\``
  const again = cleanNote(long)
  assert.ok(!bare.test(again) && ticks(again) % 2 === 0, again)
})

test('evidence T12: an already backticked handle is left alone', () => {
  assert.equal(defangMentions('ask `@alice` and `cc @bob` please'), 'ask `@alice` and `cc @bob` please')
  assert.equal(defangMentions(defangMentions('hi @alice')), 'hi `@alice`')
})
