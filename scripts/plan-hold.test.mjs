import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { isPlanHold, isRejectedTwice, resumeOutcome, replanDispatch, needsOwnerQuestion, answerDecision, cleanQuestion, recordDecision, replanFromReply } from './plan-hold.mjs'
import { appendDecision } from './lib/decision-line.mjs'
import { renderComment, RUBRIC, SIGNOFF_QUESTION, QUESTION_RECORD } from './lib/plan-verdict.mjs'
import { recordMarker } from './lib/reply-record.mjs'

const bot = (body) => ({ body, userType: 'Bot' })
const person = (body) => ({ body, userType: 'User' })
const NOGO = '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:no-go -->\n🔴 **Plan rejected twice**'
const GO = '<!-- plan-review-verdict:go -->'
const PLAN = '<!-- pipeline-plan:v1 -->\nplan'
const BLOCKED = ['status:blocked']
const hold = (comments, extra = {}) => isPlanHold({ comments, labels: BLOCKED, replyBody: 'Use the existing helper.', ...extra })

const heldThread = () => [bot(PLAN), bot(NOGO), bot(PLAN), bot(NOGO), person('Use the existing helper instead.')]

// Real threads of #3057/#3058/#3061/#3131/#3132/#3138/#3139/#3140 (bodies trimmed). Several were
// resolved later, so replay each up to its last no-go before any `go`: the moment it was held.
const dir = new URL('./fixtures/plan-hold/', import.meta.url)
const VERDICT = /plan-review-verdict:(go|no-go|needs-owner)/
function heldPrefix(comments) {
  let last = -1
  for (let i = 0; i < comments.length; i++) {
    const m = VERDICT.exec(comments[i].body)
    if (m?.[1] === 'go') break
    if (m?.[1] === 'no-go') last = i
  }
  return comments.slice(0, last + 1)
}

test('replayed real held threads each re-plan, never "still iterating"', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  assert.equal(files.length, 8)
  for (const f of files) {
    const fx = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    const comments = heldPrefix(fx.comments)
    assert.equal(isPlanHold({ comments, labels: fx.labels, replyBody: 'Use the existing helper.' }), true, `#${fx.issue}`)
    assert.equal(resumeOutcome({ planHold: true, dispatched: true, newComment: true }), 'replan', `#${fx.issue}`)
    const replyId = 900000 + fx.issue
    assert.deepEqual(replanDispatch({ issue: fx.issue, commentId: replyId }), {
      workflow_id: 'work-issue-pidev.yml',
      inputs: { issue: String(fx.issue), mode: 'plan', feedback: String(replyId) },
    }, `#${fx.issue}`)
  }
})

test('two no-go reviews, newest a no-go, status:blocked ⇒ plan hold', () => {
  assert.equal(hold(heldThread()), true)
})

test('without status:blocked it is not a hold (block dropped)', () => {
  assert.equal(isPlanHold({ comments: heldThread(), labels: [], replyBody: 'x' }), false)
})

test('plan:approved ⇒ not a hold (late reply, #3057 shape)', () => {
  assert.equal(hold(heldThread(), { labels: ['status:blocked', 'plan:approved'] }), false)
})

test('an `ok` approval is not feedback to re-plan from', () => {
  assert.equal(hold(heldThread(), { replyBody: 'ok' }), false)
  assert.equal(hold(heldThread(), { replyBody: 'lgtm' }), false)
  assert.equal(hold(heldThread(), { replyBody: 'ok: ship it' }), false)
  assert.equal(hold(heldThread(), { replyBody: 'ok: reason' }), false)
})

test('a single no-go (round 1 re-plans by itself) is not a hold', () => {
  assert.equal(hold([bot(PLAN), bot(NOGO)]), false)
})

test('a later go verdict ends the hold', () => {
  assert.equal(hold([...heldThread(), bot(PLAN), bot(GO)]), false)
})

test('a person pasting the marker does not make a hold', () => {
  assert.equal(hold([person(NOGO), person(NOGO)]), false)
})

test('design-hold / gate-PR threads without verdicts are not plan holds', () => {
  assert.equal(hold([bot('🎨 Design sign-off needed before building')]), false)
  assert.equal(hold([]), false)
  assert.equal(isPlanHold(), false)
})

test('plan hold, nothing dispatched, nothing posted ⇒ nothing (the 🔴 outcome)', () => {
  assert.equal(resumeOutcome({ planHold: true, dispatched: false, newComment: false }), 'nothing')
})

test('not a plan hold ⇒ existing behaviour', () => {
  assert.equal(resumeOutcome({ planHold: false, dispatched: false, newComment: false }), 'ok')
})

test('on-comment.yml wires the helper: replan step, agent skip, gate outcome', () => {
  const wf = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
  assert.match(wf, /id: replan/)
  assert.match(wf, /steps\.replan\.outputs\.replan != 'true'/)
  assert.match(wf, /resumeOutcome\(/)
  assert.match(wf, /\.\.\.replanDispatch\(\{ issue: issue_number, commentId: context\.payload\.comment\.id \}\)/)
  assert.match(wf, /replanFromReply\(\{ starts: process\.env\.STARTS/)
  assert.match(wf, /STARTS: \$\{\{ needs\.route\.outputs\.starts \}\}/)
})

test('#3359 a verdict quoted below visible text does not count', async () => {
  const { isPlanHold } = await import('./plan-hold.mjs')
  const q = { body: 'review of review\n<!-- plan-review-verdict:no-go -->' }
  assert.equal(isPlanHold({ comments: [q, q], labels: ['status:blocked'] }), false)
})

const OWNER = '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:needs-owner -->\n🔀 **Needs your call**'

test('#3564 newest needs-owner + a decision reply ⇒ plan hold', () => {
  assert.equal(hold([bot(PLAN), bot(NOGO), bot(PLAN), bot(OWNER), person('Decision: A')]), true)
})

test('#3564 needs-owner as the only verdict ⇒ plan hold', () => {
  assert.equal(hold([bot(PLAN), bot(OWNER)]), true)
})

// #4082 reverses #3564's "bare ok ⇒ not a re-plan": on a needs-owner hold no reply is dropped.
// covers: T1
test('#4082 newest needs-owner: every reply re-plans, approvals included', () => {
  for (const replyBody of ['ok', 'lgtm', '✅', 'ok: fine', 'Decision: A', 'yes']) {
    assert.equal(hold([bot(PLAN), bot(OWNER)], { replyBody }), true, replyBody)
  }
})

// covers: T1 (unchanged: twice-rejected hold)
test('#4082 twice-rejected hold: bare ok / ok: reason ⇒ false, a sentence ⇒ true', () => {
  assert.equal(hold(heldThread(), { replyBody: 'ok' }), false)
  assert.equal(hold(heldThread(), { replyBody: 'ok: reason' }), false)
  assert.equal(hold(heldThread(), { replyBody: 'Use the existing helper.' }), true)
})

// covers: T1 (unchanged: plan:approved, later go, pasted marker — also with reply ok)
test('#4082 needs-owner exits stay exits, even with a bare ok', () => {
  const ok = { replyBody: 'ok' }
  assert.equal(hold([bot(PLAN), bot(OWNER)], { ...ok, labels: ['status:blocked', 'plan:approved'] }), false)
  assert.equal(hold([bot(PLAN), bot(OWNER), bot(PLAN), bot(GO)], ok), false)
  assert.equal(hold([person(OWNER)], ok), false)
})

// The real #4036 needs-owner verdict (2026-11-17T11:38:26Z), checklist trimmed.
const V4036 = `<!-- plan-review:v1 -->
<!-- plan-review-verdict:needs-owner -->
> 🤖 **pi.dev harness** · agent pipeline (CI) · _plan review on \`claude-opus-5-5\`_

🔀 **Needs your call** — Do you approve the mockup in the plan as the new Activité design? That includes the plural label "Pages · Accueil", "Modification par X" instead of "modifiée par X", and no counters. Recommendation: yes. These choices read correctly for every collection in French and are easy to change later.

yes/no
**Needs:** answer

<details><summary>Review checklist</summary>

- ✅ **1. Reproduced? (observed, not reasoned)** — trimmed

</details>
`
const T4036 = () => [bot(PLAN), bot(V4036)]

// covers: T4
test('#4082 needsOwnerQuestion: the #4036 question as one line', () => {
  const q = needsOwnerQuestion(T4036())
  assert.equal(q.includes('\n'), false)
  assert.ok(q.startsWith('Do you approve the mockup in the plan as the new Activité design?'), q)
  assert.match(q, /Recommendation: yes\./)
  assert.doesNotMatch(q, /yes\s*\/\s*no$/)
  assert.ok(q.endsWith('easy to change later.'), q)
})

// covers: T4
test('#4082 needsOwnerQuestion: SIGNOFF_QUESTION verdict, and no needs-owner ⇒ empty', () => {
  const items = Object.fromEntries(RUBRIC.map((r) => [r.id, { pass: true, evidence: 'x' }]))
  const body = renderComment({ verdict: 'needs-owner', question: SIGNOFF_QUESTION, items, failed: [] })
  assert.equal(needsOwnerQuestion([bot(PLAN), bot(body)]), SIGNOFF_QUESTION)
  assert.equal(needsOwnerQuestion([bot(PLAN), bot(NOGO)]), '')
  assert.equal(needsOwnerQuestion([bot(PLAN), bot(V4036), bot(PLAN), bot(GO)]), '')
  assert.equal(needsOwnerQuestion([person(V4036)]), '')
  assert.equal(needsOwnerQuestion(), '')
})

const URL4036 = 'https://github.com/FriendlyInternet/nuxt-crouton/issues/4036#issuecomment-6947793038'
// The owner is a login (#4168): the fixture is the owner's account `pmcp`; a non-owner gets another login.
const ans = (extra = {}) => answerDecision({ comments: T4036(), replyBody: 'ok', date: '2026-11-17T12:17:16Z', url: URL4036, authorAssociation: 'OWNER', userType: 'User', userLogin: 'pmcp', ...extra })
const OTHER = 'someone-else'

// covers: T5
test('#4082 answerDecision: the owner\'s bare ok on #4036 ⇒ one Decisions line quoting the question', () => {
  const line = ans()
  assert.equal(typeof line, 'string')
  assert.equal(line.includes('\n'), false)
  assert.match(line, /^- 2026-11-17 · owner answered yes/)
  assert.ok(line.includes(needsOwnerQuestion(T4036())), line)
  assert.ok(line.endsWith(`[comment](${URL4036})`), line)
  assert.equal(typeof ans({ authorAssociation: 'MEMBER' }), 'string')
  assert.equal(typeof ans({ authorAssociation: 'COLLABORATOR' }), 'string')
})

// covers: T5
test('#4082 answerDecision: not the owner, a reason, a sentence or a twice-rejected hold ⇒ null', () => {
  assert.equal(ans({ authorAssociation: 'NONE', userLogin: OTHER }), null)
  assert.equal(ans({ authorAssociation: 'CONTRIBUTOR', userLogin: OTHER }), null)
  assert.equal(ans({ authorAssociation: undefined, userLogin: undefined }), null)
  assert.equal(ans({ userType: 'Bot' }), null)
  assert.equal(ans({ replyBody: 'ok: fine' }), null)
  assert.equal(ans({ replyBody: 'Use the existing helper instead.' }), null)
  assert.equal(ans({ comments: heldThread() }), null)
})

test('#4082 answerDecision: an approval plus other text ⇒ null; ok, ✅ or lgtm alone ⇒ the line', () => {
  assert.equal(ans({ replyBody: '✅\nNo, keep the existing schema' }), null)
  assert.equal(ans({ replyBody: 'approved, but keep the column' }), null)
  for (const replyBody of ['ok', '✅', 'lgtm']) {
    assert.match(String(ans({ replyBody })), /^- 2026-11-17 · owner answered yes/, replyBody)
  }
})

// ── #4145: recordDecision / replanFromReply — the re-plan step follows the router's `starts` ───────────────────────
const Q4036 = V4036.slice(V4036.indexOf('— ') + 2, V4036.indexOf('\n**Needs:**'))
const R4036 = QUESTION_RECORD(Q4036)
const rec = (extra = {}) => recordDecision({ record: R4036, starts: 'replan-with-yes', date: '2026-11-17T12:17:16Z', url: URL4036, authorAssociation: 'OWNER', userType: 'User', userLogin: 'pmcp', ...extra })

test('#4145 cleanQuestion: blank lines and a trailing yes / no line dropped, one line', () => {
  assert.equal(cleanQuestion('Keep it?\n\n  really  ?\nyes / no'), 'Keep it? really ?')
  assert.equal(cleanQuestion(Q4036), needsOwnerQuestion(T4036()))
  assert.equal(cleanQuestion(undefined), '')
})

// covers: T3
test('#4145 recordDecision: the owner\'s bare ok ⇒ the same line answerDecision writes (two-line question ending in yes/no)', () => {
  assert.ok(Q4036.trimEnd().endsWith('yes/no'), 'the record question spans lines and ends in yes/no')
  assert.equal(rec(), ans())
  assert.equal(rec({ authorAssociation: 'MEMBER' }), ans({ authorAssociation: 'MEMBER' }))
  assert.equal(rec({ authorAssociation: 'COLLABORATOR' }), ans({ authorAssociation: 'COLLABORATOR' }))
})

// covers: T3
test('#4145 recordDecision: a non-owner, a bot, replan-with-feedback or no starts ⇒ null', () => {
  assert.equal(rec({ authorAssociation: 'NONE', userLogin: OTHER }), null)
  assert.equal(rec({ userType: 'Bot' }), null)
  assert.equal(rec({ starts: 'replan-with-feedback' }), null)
  assert.equal(rec({ starts: '' }), null)
  assert.equal(rec({ starts: 'approve-plan' }), null)
})

const withRecord = V4036.replace('-->\n>', `-->\n${recordMarker(R4036)}\n>`)
const T4036R = () => [bot(PLAN), bot(withRecord)]
const reply = (body, extra = {}) => ({ body, date: '2026-11-17T12:17:16Z', url: URL4036, authorAssociation: 'OWNER', userType: 'User', userLogin: 'pmcp', ...extra })

// covers: T3
test('#4168 answerDecision / recordDecision / replanFromReply decide by login, not role', () => {
  // role OWNER with another login writes nothing; the owner's login under any role writes the line
  assert.equal(ans({ authorAssociation: 'OWNER', userLogin: OTHER }), null)
  assert.equal(rec({ authorAssociation: 'OWNER', userLogin: OTHER }), null)
  assert.equal(typeof ans({ authorAssociation: 'COLLABORATOR', userLogin: 'pmcp' }), 'string')
  assert.equal(typeof rec({ authorAssociation: 'NONE', userLogin: 'PMCP' }), 'string')
  // a custom owner login is honoured; '' falls back to pmcp
  assert.equal(typeof ans({ userLogin: 'alice', owner: 'alice' }), 'string')
  assert.equal(ans({ userLogin: 'pmcp', owner: 'alice' }), null)
  assert.equal(typeof ans({ owner: '' }), 'string')
  // the re-plan step's reading: another login gets no Decisions line, on both paths
  assert.equal(replanFromReply({ starts: 'replan-with-yes', comments: T4036R(), labels: BLOCKED, comment: reply('ok', { userLogin: OTHER }) }).line, null)
  assert.equal(replanFromReply({ comments: T4036(), labels: BLOCKED, comment: reply('ok', { userLogin: OTHER }) }).line, null)
  assert.equal(replanFromReply({ starts: 'replan-with-yes', comments: T4036R(), labels: BLOCKED, comment: reply('ok') }).line, ans())
})

// covers: T3
test('#4168 on-comment.yml passes the owner login to the route, re-plan, record-decision and approve-plan steps', () => {
  const wf = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
  const ENV = /OWNER_LOGIN: \$\{\{ vars\.PIPELINE_OWNER \|\| 'pmcp' \}\}/
  const between = (from, to) => wf.slice(wf.indexOf(from), wf.indexOf(to, wf.indexOf(from)))
  const route = between('- id: route', 'core.setOutput(\'kind\'')
  assert.match(route, ENV)
  assert.match(route, /routeComment\(\{\s*comment, owner: process\.env\.OWNER_LOGIN,/)
  const replan = between('- name: Re-plan a held plan from the reply', '- name: Collect the answer payload')
  assert.match(replan, ENV)
  assert.match(replan, /replanFromReply\(\{ starts: process\.env\.STARTS[^\n]*userLogin: c\.user && c\.user\.login, owner: process\.env\.OWNER_LOGIN/)
  const record = between('  record-decision:', 'recorded decision from comment')
  assert.match(record, ENV)
  assert.match(record, /parseDecision\(\{[^\n]*userLogin: c\.user\.login, owner: process\.env\.OWNER_LOGIN/)
  const approve = between('  approve-plan:', 'await approvePlan(')
  assert.match(approve, ENV)
})

// covers: T3
test('#4145 replanFromReply: with starts it re-plans without re-reading the reply', () => {
  assert.deepEqual(replanFromReply({ starts: 'replan-with-yes', comments: T4036R(), labels: BLOCKED, comment: reply('ok') }), { replan: true, line: ans(), followed: true })
  assert.deepEqual(replanFromReply({ starts: 'replan-with-feedback', comments: T4036R(), labels: BLOCKED, comment: reply('ok — build it') }), { replan: true, line: null, followed: true })
  // `ok:` on a needs-owner question reads as `other` → replan-with-feedback: no yes line (record-decision owns `ok: <reason>`).
  assert.deepEqual(replanFromReply({ starts: 'replan-with-feedback', comments: T4036R(), labels: BLOCKED, comment: reply('ok:') }), { replan: true, line: null, followed: true })
  // No record on the newest verdict ⇒ starts is not followed: today's isPlanHold (twice-rejected + approval ⇒ no).
  assert.deepEqual(replanFromReply({ starts: 'replan-with-feedback', comments: heldThread(), labels: BLOCKED, comment: reply('ok') }), { replan: false, line: null, followed: false })
})

const today = (comments, labels, body) => ({
  replan: isPlanHold({ comments, labels, replyBody: body }),
  line: answerDecision({ comments, replyBody: body, ...reply(body) }),
  followed: false,
})

// covers: T3
test('#4145 replanFromReply: plan approved since the router read the reply ⇒ same as today', () => {
  const labels = ['status:blocked', 'plan:approved']
  const r = replanFromReply({ starts: 'replan-with-yes', comments: T4036R(), labels, comment: reply('ok') })
  assert.deepEqual(r, today(T4036R(), labels, 'ok'))
  assert.deepEqual(r, { replan: false, line: ans(), followed: false })
})

// covers: T3
test('#4145 replanFromReply: newest verdict carries no record ⇒ today\'s result', () => {
  const comments = [...T4036R(), bot(PLAN), bot(NOGO)]
  const r = replanFromReply({ starts: 'replan-with-yes', comments, labels: BLOCKED, comment: reply('ok') })
  assert.deepEqual(r, today(comments, BLOCKED, 'ok'))
  assert.equal(r.followed, false)
})

// covers: T3
test('#4145 replanFromReply: the record reads the reply as replan-with-feedback ⇒ today\'s result', () => {
  const body = 'No — keep the existing schema'
  const r = replanFromReply({ starts: 'replan-with-yes', comments: T4036R(), labels: BLOCKED, comment: reply(body) })
  assert.deepEqual(r, today(T4036R(), BLOCKED, body))
  assert.deepEqual(r, { replan: true, line: null, followed: false })
})

// covers: T3
test('#4145 replanFromReply: no starts ⇒ exactly today\'s isPlanHold / answerDecision', () => {
  const cases = [
    [T4036(), 'ok'], [T4036(), 'ok:'], [T4036(), 'approved, but keep the column'],
    [heldThread(), 'ok'], [heldThread(), 'ok : x'], [heldThread(), 'Use the existing helper.'], [[bot(PLAN), bot(GO)], 'ok'],
  ]
  for (const [comments, body] of cases) {
    for (const starts of ['', undefined, 'approve-plan', 'plan-needs-reason']) {
      const r = replanFromReply({ starts, comments, labels: BLOCKED, comment: reply(body) })
      assert.equal(r.replan, isPlanHold({ comments, labels: BLOCKED, replyBody: body }), `${body} / ${starts}`)
      assert.equal(r.line, answerDecision({ comments, replyBody: body, ...reply(body) }), `${body} / ${starts}`)
      assert.equal(r.followed, false)
    }
  }
})

// covers: T5
test('#4082 appendDecision with the same line and url twice changes the body once', () => {
  const line = ans()
  const once = appendDecision('## Hypothesis\nx\n', line, URL4036)
  assert.notEqual(once, '## Hypothesis\nx\n')
  assert.equal(appendDecision(once, line, URL4036), once)
})

// covers: T6
test('#4082 on-comment.yml: replan step records the answer before dispatch; merge step skips a re-plan', () => {
  const wf = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
  const step = wf.slice(wf.indexOf('- name: Re-plan a held plan from the reply'), wf.indexOf('- name: Collect the answer payload'))
  // #4145: the author now reaches answerDecision / recordDecision through replanFromReply.
  assert.match(step, /replanFromReply\(\{[^\n]*userLogin: c\.user && c\.user\.login, owner: process\.env\.OWNER_LOGIN/)
  const at = step.indexOf('appendDecision(')
  assert.ok(at > 0 && at < step.indexOf('createWorkflowDispatch'), 'appendDecision before createWorkflowDispatch')
  assert.match(step, /Re-planning from your \\`ok\\`/)
  const merge = wf.slice(wf.indexOf('- name: Merge the gate PR on approval'))
  assert.match(merge.split('\n').find((l) => /^\s*if:/.test(l)), /steps\.replan\.outputs\.replan != 'true'/)
})

test('#3564 needs-owner with plan:approved ⇒ not a hold', () => {
  assert.equal(hold([bot(PLAN), bot(OWNER)], { labels: ['status:blocked', 'plan:approved'] }), false)
})

test('#3564 a later go after needs-owner ends the hold', () => {
  assert.equal(hold([bot(PLAN), bot(OWNER), bot(PLAN), bot(GO)]), false)
})

test('#3564 a person pasting the needs-owner marker is not a hold', () => {
  assert.equal(hold([person(OWNER)]), false)
})

// #3272: the owner-override hold is "rejected twice" only — never a needs-owner hold.
const twice = (comments, labels = BLOCKED) => isRejectedTwice({ comments, labels })

test('#3272 isRejectedTwice: two bot no-go ⇒ true', () => {
  assert.equal(twice([bot(PLAN), bot(NOGO), bot(PLAN), bot(NOGO)]), true)
})
test('#3272 isRejectedTwice: one no-go ⇒ false', () => {
  assert.equal(twice([bot(PLAN), bot(NOGO)]), false)
})
test('#3272 isRejectedTwice: a later go ⇒ false', () => {
  assert.equal(twice([bot(PLAN), bot(NOGO), bot(NOGO), bot(GO)]), false)
})
test('#3272 isRejectedTwice: newest needs-owner ⇒ false (isPlanHold stays true)', () => {
  const thread = [bot(PLAN), bot(NOGO), bot(PLAN), bot(NOGO), bot(OWNER)]
  assert.equal(twice(thread), false)
  assert.equal(hold(thread), true)
})
test('#3272 isRejectedTwice: human-pasted verdicts ⇒ false', () => {
  assert.equal(twice([bot(PLAN), person(NOGO), person(NOGO)]), false)
})
test('#3272 isRejectedTwice: plan:approved or no status:blocked ⇒ false', () => {
  const thread = [bot(PLAN), bot(NOGO), bot(PLAN), bot(NOGO)]
  assert.equal(twice(thread, ['status:blocked', 'plan:approved']), false)
  assert.equal(twice(thread, []), false)
})

// covers: T10 (#4531)
test('#4531 T10 replanFromReply: a relayed ok on a held plan question re-plans from yes and writes the Decisions line', () => {
  const relayedOk = "> 🤖 **Claude Code** · interactive agent · chat x · posted from `@pmcp`'s account (not Maarten) · _owner answer 25 Nov 02:13_\n\nok"
  const QK = QUESTION_RECORD('Keep X?')
  const verdictWithRecord = `<!-- plan-review:v1 -->\n<!-- plan-review-verdict:needs-owner -->\n${recordMarker(QK)}\n> 🤖 review\n\n🔀 **Needs your call** — Keep X?`
  const comment = { body: relayedOk, userLogin: 'pmcp', owner: 'pmcp', userType: 'User', date: '2026-11-25', url: 'u' }
  const got = replanFromReply({
    starts: 'replan-with-yes',
    comments: [bot(PLAN), bot(verdictWithRecord), { ...comment, userType: 'User' }],
    labels: ['status:blocked', 'work-this'],
    comment,
  })
  assert.equal(got.replan, true)
  assert.equal(got.followed, true)
  assert.match(got.line || '', /yes/i)
})
