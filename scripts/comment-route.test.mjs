import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeComment, KINDS } from './comment-route.mjs'
import { sourceIssueFor } from './lib/owner-screens.mjs'
import { isRejectedTwice } from './plan-hold.mjs'
import { QUESTION_RECORD, REJECTED_RECORD } from './lib/plan-verdict.mjs'

// The owner is a login (#4168): an OWNER/MEMBER fixture is the owner's account `pmcp`, any other role is someone else.
const c = (body, authorAssociation = 'OWNER', userType = 'User', userLogin = ['OWNER', 'MEMBER'].includes(authorAssociation) ? 'pmcp' : 'someone-else') => ({ body, authorAssociation, userType, userLogin })
const issue = (labels = []) => ({ number: 7, isPr: false, labels })
const pr = (o = {}) => ({ headRef: 'work-7', baseRef: 'epic/1-x', draft: false, state: 'open', ...o })
const prIssue = { number: 7, isPr: true, labels: [] }
const kind = (input) => routeComment(input).kind

test('every kind the workflow switches on is declared', () => {
  assert.equal(KINDS.length, 14)
})

test('fresh-branch (#3881): a whole-line /fresh-branch from the owner on an epic', () => {
  // 1a
  assert.equal(kind({ comment: c('/fresh-branch'), issue: issue(['epic']) }), 'fresh-branch')
  assert.equal(kind({ comment: c('  /fresh-branch  \n'), issue: issue(['epic', 'status:blocked']) }), 'fresh-branch')
  // 1b — not from a non-owner
  assert.notEqual(kind({ comment: c('/fresh-branch', 'COLLABORATOR'), issue: issue(['epic']) }), 'fresh-branch')
  assert.notEqual(kind({ comment: c('/fresh-branch', 'NONE'), issue: issue(['epic']) }), 'fresh-branch')
  // 1c — not on an issue without `epic`
  assert.notEqual(kind({ comment: c('/fresh-branch'), issue: issue([]) }), 'fresh-branch')
  // 1d — not mid-sentence
  assert.notEqual(kind({ comment: c('please /fresh-branch now'), issue: issue(['epic']) }), 'fresh-branch')
  // 1e — not in a code span or a quote
  assert.notEqual(kind({ comment: c('`/fresh-branch`'), issue: issue(['epic']) }), 'fresh-branch')
  assert.notEqual(kind({ comment: c('> /fresh-branch'), issue: issue(['epic']) }), 'fresh-branch')
  // 1f — /close-epic is unchanged
  assert.equal(kind({ comment: c('/close-epic'), issue: issue(['epic']) }), 'close-epic')
})

test('close-epic: /close-epic on an issue', () => {
  assert.equal(kind({ comment: c('/close-epic'), issue: issue() }), 'close-epic')
  assert.equal(kind({ comment: c('use `/close-epic` later'), issue: issue() }), 'interpret')
})

test('dispatch: a rocket or slash command from a collaborator', () => {
  assert.equal(kind({ comment: c('🚀'), issue: issue() }), 'dispatch')
  assert.equal(kind({ comment: c('/build'), issue: issue(['status:blocked']) }), 'dispatch')
  assert.equal(kind({ comment: c('/build', 'NONE'), issue: issue() }), 'none')
})

test('test-card: ok / not ok on a status:to-test card', () => {
  assert.equal(kind({ comment: c('ok'), issue: issue(['status:to-test']) }), 'test-card')
  assert.equal(kind({ comment: c('not ok: broken'), issue: issue(['status:to-test']) }), 'test-card')
  assert.equal(kind({ comment: c('looks fine, thanks'), issue: issue(['status:to-test']) }), 'interpret')
})

test('resume: a reply on a blocked issue; an approval on an unblocked one is explain-only', () => {
  const blocked = routeComment({ comment: c('use blue instead'), issue: issue(['status:blocked', 'delegate-pi']) })
  assert.deepEqual([blocked.kind, blocked.blocked], ['resume', true])
  const open = routeComment({ comment: c('ok'), issue: issue() })
  assert.deepEqual([open.kind, open.blocked], ['resume', false])
  assert.equal(kind({ comment: c('use blue instead'), issue: issue() }), 'interpret')
})

test('approve-draft: approval on a draft PR', () => {
  assert.equal(kind({ comment: c('✅'), issue: prIssue, pr: pr({ draft: true }) }), 'approve-draft')
})

test('approve-epic: owner approval on a ready epic → main PR', () => {
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ headRef: 'epic/9-x', baseRef: 'main' }) }), 'approve-epic')
})

test('automerge-go: approval on a ready leaf PR', () => {
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr() }), 'automerge-go')
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ headRef: 'work-7', baseRef: 'main' }) }), 'automerge-go')
})

test('revise: a change request on a pi branch', () => {
  assert.equal(kind({ comment: c('make the header bigger'), issue: prIssue, pr: pr() }), 'revise')
  assert.equal(kind({ comment: c('make the header bigger'), issue: prIssue, pr: pr({ headRef: 'fix/other' }) }), 'interpret')
})

test('none: bots, "looks good", a non-approval word that contains ok', () => {
  assert.equal(kind({ comment: c('ok', 'NONE', 'Bot'), issue: prIssue, pr: pr() }), 'none')
  assert.equal(kind({ comment: c('looks good'), issue: prIssue, pr: pr({ headRef: 'fix/other' }) }), 'interpret')
  assert.equal(kind({ comment: c('looks good'), issue: issue() }), 'interpret')
})

// The four races from the audit: each comment must start exactly ONE acting job.
test('race: bare ok on a draft PR releases it and does not also run automerge', () => {
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ draft: true }) }), 'approve-draft')
})
test('race: bare ok on an epic PR merges once (approve-epic, never automerge-go)', () => {
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ headRef: 'epic/9-x', baseRef: 'main' }) }), 'approve-epic')
})
test('race: lgtm on an epic PR merges once', () => {
  assert.equal(kind({ comment: c('lgtm'), issue: prIssue, pr: pr({ headRef: 'epic/9-x', baseRef: 'main' }) }), 'approve-epic')
})
test('race: ok on an issue with both status:blocked and status:to-test answers the card only', () => {
  assert.equal(kind({ comment: c('ok'), issue: issue(['status:blocked', 'status:to-test']) }), 'test-card')
})

test('interpret: only an owner\'s unmatched plain comment (#2980)', () => {
  assert.equal(kind({ comment: c('can we get a second opinion on this plan?'), issue: issue() }), 'interpret')
  assert.equal(kind({ comment: c('thanks', 'MEMBER'), issue: prIssue, pr: pr({ headRef: 'fix/other' }) }), 'interpret')
  // never: bots, non-owners, agent headers, slash commands, closed PRs
  assert.equal(kind({ comment: c('thanks', 'OWNER', 'Bot'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('thanks', 'COLLABORATOR'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('> 🤖 **Claude Code** · interactive agent\n\nFYI'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('/nonsense'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('thanks'), issue: prIssue, pr: pr({ headRef: 'fix/other', state: 'closed' }) }), 'none')
})

test('interpret never beats a fixed route', () => {
  assert.equal(kind({ comment: c('ok'), issue: issue(['status:blocked']) }), 'resume')
  assert.equal(kind({ comment: c('anything at all'), issue: issue(['status:blocked', 'delegate-pi']) }), 'resume')
  assert.equal(kind({ comment: c('**Worker:** fix it'), issue: prIssue, pr: pr() }), 'revise')
  assert.equal(kind({ comment: c('lgtm'), issue: prIssue, pr: pr({ draft: true }) }), 'approve-draft')
  assert.equal(kind({ comment: c('🚀'), issue: issue() }), 'dispatch')
})

test('held tickets: pipeline-owned → resume, otherwise the owner\'s plain comment is interpreted (#2980)', () => {
  const held = ['status:blocked']
  const text = 'can we have a fresh pass on this plan?'
  assert.equal(kind({ comment: c(text), issue: { ...issue(held), body: 'plan\n<!-- pipeline: epic=1 -->' } }), 'resume')
  assert.equal(kind({ comment: c(text), issue: issue([...held, 'work-this']) }), 'resume')
  assert.equal(kind({ comment: c(text), issue: { ...issue(held), body: 'a held plan' } }), 'interpret')
  assert.equal(kind({ comment: c('ok'), issue: { ...issue(held), body: 'a held plan' } }), 'resume')
})

test('revise: an interactive-agent **Worker:** request (posted via the Claude app as a User) routes (#3029)', () => {
  const body = '> 🤖 **Claude Code** · interactive agent · posted from pmcp\n\n**Worker:** rename the header'
  const viaClaude = { ...c(body, 'MEMBER'), performedViaGithubApp: 'Claude' }
  assert.equal(kind({ comment: viaClaude, issue: prIssue, pr: pr() }), 'revise')
})
test('none: a comment posted via any other GitHub App is dropped, even under a User identity', () => {
  const body = '**Worker:** rename the header'
  const viaOther = { ...c(body, 'MEMBER'), performedViaGithubApp: 'Some App' }
  assert.equal(kind({ comment: viaOther, issue: prIssue, pr: pr() }), 'none')
})
test('interpret: never for an app-posted comment, only revise via **Worker:**', () => {
  const viaClaude = { ...c('can we get a second opinion on this plan?', 'MEMBER'), performedViaGithubApp: 'Claude' }
  assert.equal(kind({ comment: viaClaude, issue: issue() }), 'none')
  const viaOther = { ...viaClaude, performedViaGithubApp: 'Some App' }
  assert.equal(kind({ comment: viaOther, issue: issue() }), 'none')
})

// Owner quiz (#3715) — cases 3 and 7 of the agreed list, through the real router.
test('quiz-reply: an owner answer line routes to its own kind; others and bots are ignored (case 3)', () => {
  assert.equal(kind({ comment: c('1B 2a 3?'), issue: issue(['epic']) }), 'quiz-reply')
  assert.equal(kind({ comment: c('1B 2a 3?', 'MEMBER'), issue: issue() }), 'quiz-reply')
  assert.equal(kind({ comment: c('2 code'), issue: issue() }), 'quiz-reply')
  assert.equal(kind({ comment: c('1B 2a 3?', 'COLLABORATOR'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('1B 2a 3?', 'CONTRIBUTOR'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('1B 2a 3?', 'OWNER', 'Bot'), issue: issue() }), 'none')
})

test('quiz-reply: on a blocked, pipeline-owned epic it never resumes (case 3)', () => {
  const held = { ...issue(['status:blocked', 'epic', 'work-this']), body: '<!-- pipeline: epic=1 -->' }
  assert.equal(kind({ comment: c('1B 2A 3C'), issue: held }), 'quiz-reply')
  assert.equal(kind({ comment: c('2 code'), issue: { ...issue(['status:to-test']) } }), 'quiz-reply')
})

// #3691 — owner-screen comments (🎯/📐 from the Nuxt Harness app on a waiting item).
const app = (body) => ({ body, authorAssociation: 'NONE', userType: 'Bot', performedViaGithubApp: 'Nuxt Harness', appSlug: 'nuxt-harness', userLogin: 'nuxt-harness[bot]' })
const SAVE = '📐 Diagram saved — continuing from your edit\n<!-- owner-screen:diagram slug=f branch=work-7 sha=a path=writeups/diagrams/f.excalidraw -->'
const heldIssue = { ...issue(['status:blocked', 'work-this']), body: '<!-- pipeline: base=main -->' }
const heldPr = { number: 7, isPr: true, labels: ['status:blocked'] }

test('owner screen: 📐 on a blocked pipeline-owned issue resumes', () => {
  const d = routeComment({ comment: app(SAVE), issue: heldIssue })
  assert.deepEqual([d.kind, d.blocked], ['resume', true])
  assert.equal(kind({ comment: app(SAVE), issue: issue(['status:blocked']) }), 'none') // not pipeline-owned
})

test('owner screen: 🎯 on a blocked work-N PR revises', () => {
  // "blocked" = the PR's source issue (`Closes #N`) carries the label — the PR itself does not.
  assert.equal(kind({ comment: app('🎯 **Preview feedback**\n\n> move it left'), issue: { ...heldPr, labels: [] }, pr: pr({ sourceIssue: { number: 7, labels: ['status:blocked'] } }) }), 'revise')
})

// #3691 review hole 1 — held drafts (#3687, #3685) carry no status:blocked; their source issue does.
const FB = '🎯 **Preview feedback**\n\n> move it left'
const prBody = (n) => `Closes #${n}\n\nbody`
const issueAt = (labels) => async () => ({ labels: labels.map(name => ({ name })) })
const prFacts = async (body, labels) => pr({ draft: true, sourceIssue: await sourceIssueFor({ comment: app(FB), prBody: body, getIssue: issueAt(labels) }) })

test('owner screen on a PR: source issue blocked + PR unlabelled → wakes (revise)', async () => {
  assert.equal(kind({ comment: app(FB), issue: { ...heldPr, labels: [] }, pr: await prFacts(prBody(7), ['status:blocked']) }), 'revise')
})

test('owner screen on a PR: source issue not blocked → does not wake, even if the PR is labelled', async () => {
  assert.equal(kind({ comment: app(FB), issue: { ...heldPr, labels: ['status:blocked'] }, pr: await prFacts(prBody(7), []) }), 'none')
})

test('owner screen on a PR: no linked issue → does not wake', async () => {
  let fetched = false
  const sourceIssue = await sourceIssueFor({ comment: app(FB), prBody: 'no link here; see `Closes #7` in code', getIssue: async () => { fetched = true; return { labels: [{ name: 'status:blocked' }] } } })
  assert.equal(sourceIssue, null)
  assert.equal(fetched, false)
  assert.equal(kind({ comment: app(FB), issue: { ...heldPr, labels: ['status:blocked'] }, pr: pr({ draft: true, sourceIssue }) }), 'none')
})

test('owner screen: unblocked, no emoji, a quote or another app → none', () => {
  assert.equal(kind({ comment: app(SAVE), issue: { ...heldIssue, labels: ['work-this'] } }), 'none')
  assert.equal(kind({ comment: app('> 🤖 **pi.dev harness** · x'), issue: heldIssue }), 'none')
  assert.equal(kind({ comment: app('> 📐 Diagram saved'), issue: heldIssue }), 'none')
  assert.equal(kind({ comment: { ...app(SAVE), appSlug: 'github-actions', userLogin: 'github-actions[bot]', performedViaGithubApp: 'GitHub Actions' }, issue: heldIssue }), 'none')
})

test('owner screen: 📐/🎯 containing ok never approves or merges', () => {
  const bodies = [SAVE + '\nok', '🎯 **Preview feedback**\n\n> ok', '🎯 x\nlgtm']
  const prs = [pr({ draft: true }), pr(), pr({ headRef: 'epic/9-x', baseRef: 'main' })]
  for (const body of bodies) {
    for (const p of prs) {
      for (const labels of [['status:blocked'], []]) {
        const k = kind({ comment: { ...app(body), authorAssociation: 'OWNER' }, issue: { ...heldPr, labels }, pr: { ...p, labels } })
        assert.ok(!['approve-draft', 'approve-epic', 'automerge-go'].includes(k), `${body} → ${k}`)
      }
    }
  }
})

test('#3272 owner override on a plan held after two rejections', () => {
  const held = { ...issue(['status:blocked', 'delegate-pi']), planHeld: true }
  assert.equal(kind({ comment: c('ok: the reviewer point is cosmetic'), issue: held }), 'approve-plan')
  assert.equal(kind({ comment: c('ok: the reviewer point is cosmetic', 'MEMBER'), issue: held }), 'approve-plan')
  assert.equal(kind({ comment: c('ok'), issue: held }), 'plan-needs-reason')
  assert.equal(kind({ comment: c('lgtm'), issue: held }), 'plan-needs-reason')
  // a non-owner's reply on a held issue counts for nothing (#4168)
  assert.equal(kind({ comment: c('ok: why', 'CONTRIBUTOR'), issue: held }), 'none')
  assert.equal(kind({ comment: c('please also cover the mobile case'), issue: held }), 'resume')
  assert.equal(kind({ comment: c('ok: why'), issue: { ...held, planHeld: false } }), 'resume')
  assert.equal(kind({ comment: c('1B 2A 3C'), issue: held }), 'quiz-reply')
})

test('#3272 planHeld worked out from a real thread (plan, no-go, plan, no-go)', () => {
  const NOGO = '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:no-go -->\n🔴 **Plan rejected**'
  const PLAN = '<!-- pipeline-plan:v1 -->\nplan'
  const thread = [PLAN, NOGO, PLAN, NOGO].map((body) => ({ body, userType: 'Bot' }))
  const labels = ['status:blocked', 'delegate-pi']
  const planHeld = isRejectedTwice({ comments: thread, labels })
  assert.equal(planHeld, true)
  const held = { ...issue(labels), planHeld }
  assert.equal(kind({ comment: c('ok: the reviewer point is cosmetic'), issue: held }), 'approve-plan')
  assert.equal(kind({ comment: c('ok'), issue: held }), 'plan-needs-reason')
})

// ── #4145: the router reads the reply against the open reply record ─────────────────────────────────────────────────
const QREC = QUESTION_RECORD('Keep the legacy path?')
const asked = { ...issue(['status:blocked', 'work-this']), planHeld: false }
const rejected = { ...issue(['status:blocked', 'work-this']), planHeld: true }
const pick = (d) => ({ kind: d.kind, starts: d.starts })

// covers: T2
test('#4145 record: plan-question replies resume with the starts readReply gives; record-less twin = today, no starts', () => {
  const cases = [
    ['ok', 'replan-with-yes'], ['✅', 'replan-with-yes'], ['lgtm', 'replan-with-yes'],
    ['ok — build it', 'replan-with-feedback'], ['approved, but keep the column', 'replan-with-feedback'],
    ['ok:', 'replan-with-feedback'], ['drop it, keep the new one', 'replan-with-feedback'],
  ]
  for (const [body, starts] of cases) {
    assert.deepEqual(pick(routeComment({ comment: c(body), issue: asked, record: QREC })), { kind: 'resume', starts }, body)
    const today = routeComment({ comment: c(body), issue: asked, record: null })
    assert.equal(today.kind, 'resume', body)
    assert.equal('starts' in today, false, body)
  }
})

// covers: T2
test('#4145 record: plan-rejected replies — owner ok: <reason> / approval decided by the record, same kind as today', () => {
  const cases = [
    ['ok: the reviewer point is cosmetic', 'OWNER', { kind: 'approve-plan', starts: undefined }],
    ['> quoted\nok: the reviewer point is cosmetic', 'OWNER', { kind: 'approve-plan', starts: undefined }],
    ['ok: cosmetic', 'MEMBER', { kind: 'approve-plan', starts: undefined }],
    ['ok', 'OWNER', { kind: 'plan-needs-reason', starts: undefined }],
    ['approved, but keep the column', 'OWNER', { kind: 'plan-needs-reason', starts: undefined }],
    ['change X', 'OWNER', { kind: 'resume', starts: 'replan-with-feedback' }],
    // a non-owner's reply on a held issue counts for nothing (#4168)
    ['ok: cosmetic', 'COLLABORATOR', { kind: 'none', starts: undefined }],
    // `ok : x` is no accepted form → today's result
    ['ok : x', 'OWNER', { kind: 'resume', starts: undefined }],
  ]
  for (const [body, assoc, want] of cases) {
    const got = routeComment({ comment: c(body, assoc), issue: rejected, record: REJECTED_RECORD })
    assert.deepEqual(pick(got), want, `${assoc} ${body}`)
    assert.equal(routeComment({ comment: c(body, assoc), issue: rejected, record: null }).kind, want.kind, `today: ${assoc} ${body}`)
  }
})

// covers: T2
test('#4145 record: the resume gate is kept and a record never acts on a non-blocked issue', () => {
  const notOwned = { ...issue(['status:blocked']), planHeld: false }
  // not pipeline-owned, not an approval → falls through to today's interpret
  assert.deepEqual(pick(routeComment({ comment: c('drop it'), issue: notOwned, record: QREC })), { kind: 'interpret', starts: undefined })
  // an approval passes the gate
  assert.deepEqual(pick(routeComment({ comment: c('ok'), issue: notOwned, record: QREC })), { kind: 'resume', starts: 'replan-with-yes' })
  // not blocked → the record is ignored
  assert.deepEqual(pick(routeComment({ comment: c('ok'), issue: issue(['work-this']), record: QREC })), { kind: 'resume', starts: undefined })
  // a bot reply is still dropped
  assert.equal(routeComment({ comment: c('ok', 'OWNER', 'Bot'), issue: asked, record: QREC }).kind, 'none')
})

test('quiz-reply: `ok` on a blocked epic still resumes, as before (case 7)', () => {
  assert.equal(kind({ comment: c('ok'), issue: issue(['status:blocked', 'epic']) }), 'resume')
  assert.equal(kind({ comment: c('ok'), issue: issue() }), 'resume')
})

// ── #4168: the owner is a LOGIN, not a role ─────────────────────────────────────────────────────────────────────────────
// covers: T2
test('#4168 the owner arriving as COLLABORATOR (workflow token) still approves a held plan', () => {
  const held = { ...issue(['status:blocked', 'delegate-pi']), planHeld: true }
  assert.equal(kind({ comment: c('ok: x', 'COLLABORATOR', 'User', 'pmcp'), issue: held }), 'approve-plan')
  assert.equal(kind({ comment: c('ok: x', 'COLLABORATOR', 'User', 'pmcp'), issue: held, record: REJECTED_RECORD }), 'approve-plan')
  // a custom owner login is honoured, and the default no longer applies
  assert.equal(kind({ comment: c('ok: x', 'COLLABORATOR', 'User', 'alice'), issue: held, owner: 'alice' }), 'approve-plan')
  assert.notEqual(kind({ comment: c('ok: x', 'OWNER', 'User', 'pmcp'), issue: held, owner: 'alice' }), 'approve-plan')
})

// covers: T2
test('#4168 a MEMBER with another login is not the owner', () => {
  const held = { ...issue(['status:blocked', 'delegate-pi']), planHeld: true }
  assert.notEqual(kind({ comment: c('ok: x', 'MEMBER', 'User', 'someone-else'), issue: held }), 'approve-plan')
  assert.notEqual(kind({ comment: c('ok: x', 'MEMBER', 'User', 'someone-else'), issue: held, record: REJECTED_RECORD }), 'approve-plan')
})

// covers: T2
test("#4168 a non-owner's reply on a blocked issue → none, with or without an open reply record", () => {
  const owned = { ...issue(['status:blocked', 'work-this']), body: '<!-- pipeline: epic=1 -->', planHeld: false }
  for (const [assoc, login] of [['NONE', 'someone-else'], ['COLLABORATOR', 'someone-else'], ['OWNER', 'someone-else']]) {
    for (const record of [null, QREC]) {
      for (const body of ['ok', 'lgtm', 'please change X']) {
        const d = routeComment({ comment: c(body, assoc, 'User', login), issue: owned, record })
        assert.equal(d.kind, 'none', `${assoc}/${login} ${body} record=${!!record}`)
        assert.equal('starts' in d, false)
      }
    }
  }
  // the owner's own `ok` on the same issue still resumes
  assert.equal(kind({ comment: c('ok', 'COLLABORATOR', 'User', 'pmcp'), issue: owned, record: QREC }), 'resume')
  assert.equal(kind({ comment: c('ok', 'COLLABORATOR', 'User', 'pmcp'), issue: owned }), 'resume')
})

// covers: T2
test('#4168 a 📐 owner-screen comment from the Harness app on a blocked pipeline-owned issue still resumes', () => {
  assert.equal(kind({ comment: app(SAVE), issue: heldIssue }), 'resume')
})

// ── #4192: only the owner's first answer to the worker's question starts the worker ────────────────────────────────────────────────
const WREC = { kind: 'worker-question', question: 'A or B?', accepts: ['other'], starts: { other: 'answer-worker' } }
const building = { ...issue(['status:blocked', 'work-this', 'plan:approved']), planHeld: false }
const chat = (ctx, text = 'x') => c(`> 🤖 **Claude Code** · interactive agent · chat 1be68d · posted from \`@pmcp\`'s account (not Maarten) · _${ctx}_\n\n${text}`, 'COLLABORATOR', 'User', 'pmcp')

// covers: T4
test('#4192 record: the owner\'s answer (typed or relayed) on an open worker question resumes with answer-worker', () => {
  assert.deepEqual(pick(routeComment({ comment: c('A'), issue: building, record: WREC })), { kind: 'resume', starts: 'answer-worker' })
  assert.deepEqual(pick(routeComment({ comment: chat('owner answer in chat 2026-11-17', '**A** — default it off.'), issue: building, record: WREC })), { kind: 'resume', starts: 'answer-worker' })
})

// covers: T4
test("#4192 record: a chat's status note from the owner's account (🪪 claim, ✅ FYI) starts nothing", () => {
  for (const note of [chat('claim', '🪪 claimed by chat 1be68d'), chat('FYI', '✅ done: merged the sibling')]) {
    const d = routeComment({ comment: note, issue: building, record: WREC })
    assert.deepEqual(pick(d), pick(routeComment({ comment: note, issue: building, record: null })), 'same as today')
    assert.equal(d.starts, undefined)
  }
})

// covers: T4
test('#4192 record: a non-owner reply → none; a second owner ok (record closed) → today', () => {
  assert.equal(kind({ comment: c('A', 'COLLABORATOR', 'User', 'someone-else'), issue: building, record: WREC }), 'none')
  assert.deepEqual(pick(routeComment({ comment: c('ok'), issue: building, record: null })), { kind: 'resume', starts: undefined })
})

// covers: T2
test("#4168 a collaborator's pipeline command on a blocked issue still dispatches", () => {
  assert.equal(kind({ comment: c('/build', 'COLLABORATOR', 'User', 'someone-else'), issue: issue(['status:blocked']) }), 'dispatch')
})
