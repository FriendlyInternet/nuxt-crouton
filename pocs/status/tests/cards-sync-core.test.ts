import { describe, expect, it } from 'vitest'
import {
  EPIC_SYNC_MARKER, SIGNOFF_PREVIEW_MARKER, cardKey, collectAsks, planSync, stuckCounts,
  type Ask, type EpicSyncItem, type ExistingCard, type GhComment, type GhCommit, type GhEvent, type GhUser, type QuizItem, type SyncItem
} from '../server/utils/cards-sync-core'

// Pure rules of POST /api/cards/sync (#3777). Fixtures are built inline with small builders.

let seq = 1000
const T = (h: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, 0) + h * 3_600_000).toISOString()
const BOT: GhUser = { login: 'nuxt-harness[bot]', type: 'Bot' }
const GHA: GhUser = { login: 'github-actions[bot]', type: 'Bot' }
const OWNER: GhUser = { login: 'pmcp', type: 'User' }
const MALLORY: GhUser = { login: 'mallory', type: 'User' }

const comment = (user: GhUser, body: string, at: string): GhComment => {
  const id = seq++
  return { id, user, body, created_at: at, html_url: `https://github.com/o/r/issues/1#issuecomment-${id}` }
}
const event = (label: string, at: string): GhEvent => ({ event: 'labeled', label: { name: label }, created_at: at })
const commit = (sha: string, at: string, opts: { merge?: boolean, ciFix?: boolean } = {}): GhCommit => ({
  sha,
  parents: opts.merge ? [{}, {}] : [{}],
  commit: {
    message: opts.ciFix ? `fix: ci\n\nCI-Fix: true` : `feat: ${sha}`,
    committer: { name: opts.ciFix ? 'claude[bot]' : 'someone', date: at }
  }
})
const issue = (n: number, o: Partial<SyncItem> = {}): SyncItem => ({
  number: n, isPr: false, title: `Issue ${n}`, html_url: `https://github.com/o/r/issues/${n}`,
  labels: [], user: OWNER, body: '', state: 'open', comments: [], events: [], ...o
})
const pr = (n: number, o: Partial<SyncItem> = {}): SyncItem => ({
  number: n, isPr: true, title: `PR ${n}`, html_url: `https://github.com/o/r/pull/${n}`,
  labels: [], user: BOT, body: '', state: 'open', comments: [], events: [], commits: [commit(`sha${n}`, T(2))], headSha: `sha${n}`, ...o
})

const designHoldBody = (edit = false) => [
  '<!-- design-signoff-hold -->',
  '> 🤖 **pi.dev harness** · agent pipeline (CI) · _design sign-off gate (#1821)_',
  '',
  '## 🎨 Design sign-off needed before building',
  '',
  'Pick the layout.',
  ...(edit ? ['**Diagram**', '', '![Diagram](https://raw/x.png)', '[✏️ Edit this diagram](https://diagram.pmcp.dev/?slug=a&branch=b)'] : [])
].join('\n')
const planVerdict = (v: string) => `<!-- plan-review-verdict:${v} -->\n> 🤖 plan review\n\nverdict ${v}`
const buildReview = (sha: string, v: string, final = false) =>
  [`<!-- build-review-sha:${sha} -->`, `<!-- build-review-verdict:${v} -->`, ...(final ? ['<!-- build-review-final -->'] : []), '', '🔴 **Build rejected twice**'].join('\n')
const KEY_B64 = Buffer.from(JSON.stringify([{ a: 'B', s: 'secret answer' }])).toString('base64url')
const quizBody = (pr = 77) => [
  '> 🤖 **pi.dev harness** · agent pipeline (CI) · _owner quiz (#3715) — it blocks nothing_',
  '',
  `## 🧠 Quick check — PR #${pr} reached main`,
  '',
  '**1.** The inbox shows a card per ask',
  '- **A** — yes',
  '- **B** — no',
  '- **C** — only on Mondays',
  '',
  '**2.** Cards answered in the inbox change on sync',
  '- **A** — always',
  '- **B** — never',
  '- **C** — sometimes',
  '',
  `<!-- owner-quiz:v1 pr=${pr} sha=abc123 key=${KEY_B64} -->`
].join('\n')

// fixtures, one per kind
const signoffPr = (n = 10, closes = 11) => pr(n, { body: `Closes #${closes}\n\nHeld for your sign-off.\n${SIGNOFF_PREVIEW_MARKER}`, closesIssue: closes })
const buildFinalPr = (n = 20) => pr(n, { user: MALLORY, headSha: `abc${n}`, comments: [comment(BOT, buildReview(`abc${n}`, 'no-go', true), T(3))] })
const buildOwnerPr = (n = 21) => pr(n, { user: MALLORY, headSha: `abc${n}`, comments: [comment(BOT, buildReview(`abc${n}`, 'needs-owner'), T(3))] })
const needsMergePr = (n = 30, closes = 31) => pr(n, { labels: ['status:needs-merge'], events: [event('status:needs-merge', T(4))], closesIssue: closes, body: `Closes #${closes}` })
const designIssue = (n = 40, edit = false) => issue(n, { labels: ['status:blocked'], events: [event('status:blocked', T(1))], comments: [comment(BOT, designHoldBody(edit), T(5))] })
const planIssue = (n = 50) => issue(n, { labels: ['status:blocked'], events: [event('status:blocked', T(1))], comments: [comment(GHA, planVerdict('needs-owner'), T(6))] })
const linkIssue = (n = 60) => issue(n, { labels: ['status:blocked'], events: [event('status:blocked', T(7))] })
const deliveryEpic = (n = 70, labels = ['epic', 'status:to-test', 'app:velo']) => issue(n, {
  labels, events: [event('status:to-test', T(8))], body: '## 🧪 How to test\n1. Open `/admin/bookings`\n2. See the list'
})
const quizItem = (n = 80): QuizItem => ({ number: n, isPr: false, title: `Epic ${n}`, html_url: `https://github.com/o/r/issues/${n}`, comments: [comment(GHA, quizBody(), T(9))] })

const allItems = () => [signoffPr(), buildFinalPr(), buildOwnerPr(), needsMergePr(), designIssue(), planIssue(), linkIssue(), deliveryEpic()]

/** Apply a plan to an in-memory card table (what the endpoint writes to the DB). */
function apply(existing: ExistingCard[], plan: ReturnType<typeof planSync>): ExistingCard[] {
  const out = existing.map(c => ({ ...c }))
  for (const u of plan.update) Object.assign(out.find(c => c.id === u.id)!, u.patch)
  for (const c of plan.create) out.push({ ...c, id: `card${seq++}` } as unknown as ExistingCard)
  return out
}
function sync(input: { items: SyncItem[], quizItems?: QuizItem[] }, existing: ExistingCard[] = [], gone: Record<string, { comments: GhComment[] }> = {}, listsComplete = true) {
  const { asks, unreadable } = collectAsks(input)
  const plan = planSync({ asks, unreadable, existing, gone, listsComplete })
  return { asks, unreadable, plan, cards: apply(existing, plan) }
}
const cardFrom = (a: Ask, o: Partial<ExistingCard> = {}): ExistingCard => ({ ...a, id: `card${seq++}`, state: 'waiting', ...o })

describe('cards-sync-core', () => {
  it('1. one fixture per kind → the right kind / sourceType / sourceNumber', () => {
    const { asks } = collectAsks({ items: allItems(), quizItems: [quizItem()] })
    const got = asks.map(a => [a.kind, a.sourceType, a.sourceNumber])
    expect(got).toEqual(expect.arrayContaining([
      ['review', 'pr', 10], ['review', 'pr', 20], ['review', 'pr', 21], ['review', 'pr', 30],
      ['review', 'issue', 40], ['review', 'issue', 50], ['issue', 'issue', 60], ['delivery', 'issue', 70], ['quiz', 'issue', 80]
    ]))
    expect(asks).toHaveLength(9)
  })

  it('2. same input twice → second run changes nothing', () => {
    const input = { items: allItems(), quizItems: [quizItem()] }
    const first = sync(input)
    expect(first.plan.counts.created).toBe(9)
    const second = sync(input, first.cards)
    expect(second.plan.counts).toEqual({ created: 0, updated: 0, stale: 0, answered: 0 })
  })

  it('3. quiz payload never carries the key; statements + 3 choices parsed', () => {
    const { asks } = collectAsks({ items: [], quizItems: [quizItem()] })
    const q = asks.find(a => a.kind === 'quiz')!
    const json = JSON.stringify(q.payload)
    expect(json).not.toContain('key')
    expect(json).not.toContain(KEY_B64)
    expect(json).not.toContain('secret answer')
    expect(q.payload).toEqual({ pr: 77, questions: [
      { statement: 'The inbox shows a card per ask', choices: ['yes', 'no', 'only on Mondays'] },
      { statement: 'Cards answered in the inbox change on sync', choices: ['always', 'never', 'sometimes'] }
    ] })
  })

  it('4. link card whose item is gone + a later ok from pmcp → answered via github', () => {
    const first = sync({ items: [linkIssue()] })
    const card = first.cards[0]!
    const ok = comment(OWNER, 'ok', T(10))
    const next = sync({ items: [] }, first.cards, { [cardKey(card)]: { comments: [ok] } })
    expect(next.plan.counts.answered).toBe(1)
    expect(next.cards[0]).toMatchObject({ state: 'answered', answeredVia: 'github', answerUrl: ok.html_url })
    expect((next.cards[0] as any).answeredAt).toEqual(new Date(T(10)))
  })

  it('5. a card answered via the inbox is unchanged by a sync', () => {
    const { asks } = collectAsks({ items: [designIssue()] })
    const card = cardFrom(asks[0]!, { state: 'answered', answeredVia: 'inbox' })
    const gone = { [cardKey(card)]: { comments: [comment(OWNER, 'ok', T(10))] } }
    expect(sync({ items: [designIssue()] }, [card], gone).plan.update).toEqual([])
    expect(sync({ items: [] }, [card], gone).plan.update).toEqual([])
  })

  it('6. ticket-review needs-owner, merge-conflict hold and twice-rejected plan → one issue card each', () => {
    const ticketReview = issue(90, { labels: ['epic', 'status:blocked'], events: [event('status:blocked', T(1))], comments: [comment(GHA, '<!-- ticket-review-verdict:needs-owner -->\nneeds owner', T(2))] })
    const conflictPr = pr(91, { user: MALLORY, closesIssue: 92, body: 'Closes #92', comments: [comment(GHA, '## 🔀 Blocked — merge conflict', T(2))] })
    const conflictIssue = issue(92, { labels: ['status:blocked'], events: [event('status:blocked', T(2))] })
    const twice = issue(93, { labels: ['status:blocked'], events: [event('status:blocked', T(1))], comments: [comment(GHA, planVerdict('no-go'), T(2)), comment(GHA, planVerdict('no-go'), T(3))] })
    const { asks } = collectAsks({ items: [ticketReview, conflictPr, conflictIssue, twice] })
    expect(asks.map(a => [a.kind, a.sourceNumber]).sort()).toEqual([['issue', 90], ['issue', 92], ['issue', 93]])
  })

  it('7. a 101st comment ok from pmcp (gone read uses since, not page 1) → answered', () => {
    const first = sync({ items: [linkIssue()] })
    const card = first.cards[0]!
    const thread = Array.from({ length: 100 }, (_, i) => comment(MALLORY, `noise ${i}`, T(8 + i / 100)))
    thread.push(comment(OWNER, 'ok', T(10)))
    expect(thread.indexOf(thread[100]!)).toBe(100)
    const next = sync({ items: [] }, first.cards, { [cardKey(card)]: { comments: thread } })
    expect(next.cards[0]!.state).toBe('answered')
  })

  it('8. one ask in, one card out', () => {
    const one = (items: SyncItem[]) => collectAsks({ items }).asks
    // sign-off hold: PR marker + its Closes #N issue labelled blocked
    let a = one([signoffPr(10, 11), linkIssue(11)])
    expect(a.map(x => [x.kind, x.sourceType, x.sourceNumber])).toEqual([['review', 'pr', 10]])
    // build-review hold + its labelled issue
    a = one([{ ...buildFinalPr(20), closesIssue: 22 }, linkIssue(22)])
    expect(a.map(x => [x.kind, x.sourceNumber])).toEqual([['review', 20]])
    // design hold followed by a pipeline note, a 📐 save and a blocker-closed note
    const hold = designIssue(40)
    const holdId = String(hold.comments[0]!.id)
    hold.comments.push(
      comment(GHA, '<!-- pipeline-note -->\nheld for sign-off', T(5.1)),
      comment(BOT, '📐 saved a drawing', T(5.2)),
      comment(GHA, '🔄 the blocker this was waiting on (#12) has since closed — re-check whether this hold still applies.', T(5.3))
    )
    a = one([hold])
    expect(a.map(x => [x.kind, x.sourceNumber, x.sourceCommentId])).toEqual([['review', 40, holdId]])
    // design hold followed by a plan → the hold was answered, falls to a link card
    const planned = designIssue(41)
    planned.comments.push(comment(BOT, '<!-- pipeline-plan:v1 -->\nthe plan', T(6)))
    a = one([planned])
    expect(a.map(x => [x.kind, x.sourceNumber])).toEqual([['issue', 41]])
    // no diagram → no editUrl; Edit link → editUrl
    expect(one([designIssue(42)])[0]!.payload).toEqual({})
    expect(one([designIssue(43, true)])[0]!.payload).toEqual({ editUrl: 'https://diagram.pmcp.dev/?slug=a&branch=b' })
    // needs-merge PR + its issue
    a = one([needsMergePr(30, 31), linkIssue(31)])
    expect(a.map(x => [x.kind, x.sourceType, x.sourceNumber])).toEqual([['review', 'pr', 30]])
  })

  it('9. PR card keys on the newest non-merge, non-CI-fix commit across 45 commits', () => {
    const commits = Array.from({ length: 45 }, (_, i) => commit(`sha${i + 1}`, T(i / 10)))
    const p = signoffPr(10, 11)
    p.commits = commits
    const first = sync({ items: [p] })
    expect(first.asks[0]!.sourceCommentId).toBe('sha45')
    const answered = first.cards.map(c => ({ ...c, state: 'answered', answeredVia: 'inbox' }))
    // a merge commit → no new card
    const merged = sync({ items: [{ ...p, commits: [...commits, commit('m1', T(10), { merge: true })] }] }, answered)
    expect(merged.plan.counts).toEqual({ created: 0, updated: 0, stale: 0, answered: 0 })
    // a CI-fix commit → no new card
    const ciFix = sync({ items: [{ ...p, commits: [...commits, commit('fix1', T(10), { ciFix: true })] }] }, answered)
    expect(ciFix.plan.counts.created).toBe(0)
    // a normal commit → one new waiting card
    const revised = sync({ items: [{ ...p, commits: [...commits, commit('m1', T(10), { merge: true }), commit('sha46', T(11))] }] }, answered)
    expect(revised.plan.counts.created).toBe(1)
    expect(revised.plan.create[0]).toMatchObject({ sourceCommentId: 'sha46', state: 'waiting' })
  })

  it('10. askedAt per source', () => {
    // epic created long before its hold → askedAt = the labeled event
    const old = issue(60, { labels: ['epic', 'status:blocked'], events: [event('status:blocked', T(-100)), event('status:blocked', T(50))] })
    expect(collectAsks({ items: [old] }).asks[0]!.askedAt).toBe(T(50))
    // needs-merge → the later of label and commit
    const labelLater = pr(30, { labels: ['status:needs-merge'], events: [event('status:needs-merge', T(5))], commits: [commit('a', T(3))] })
    expect(collectAsks({ items: [labelLater] }).asks[0]!.askedAt).toBe(T(5))
    const commitLater = pr(30, { labels: ['status:needs-merge'], events: [event('status:needs-merge', T(1))], commits: [commit('a', T(3))] })
    expect(collectAsks({ items: [commitLater] }).asks[0]!.askedAt).toBe(T(3))
    // hold comment → its created_at; delivery → to-test label
    expect(collectAsks({ items: [designIssue()] }).asks[0]!.askedAt).toBe(T(5))
    expect(collectAsks({ items: [deliveryEpic()] }).asks[0]!.askedAt).toBe(T(8))
  })

  it('11. to-test epic labelled app:velo → payload.app; no app/poc label → no app key', () => {
    const withApp = collectAsks({ items: [deliveryEpic()] }).asks[0]!
    expect(withApp.payload.app).toBe('velo')
    expect(withApp.payload.steps).toEqual(['Open `/admin/bookings`', 'See the list'])
    expect(withApp.payload.to).toBe('/admin/bookings')
    const without = collectAsks({ items: [deliveryEpic(71, ['epic', 'status:to-test'])] }).asks[0]!
    expect('app' in without.payload).toBe(false)
  })

  it('12. forged markers (by a User, or quoted by the bot) make no card', () => {
    const forgedPr = { ...signoffPr(10, 11), user: MALLORY }
    const forgedReview = pr(20, { user: MALLORY, headSha: 'abc20', comments: [comment(MALLORY, buildReview('abc20', 'no-go', true), T(3))] })
    const forgedHold = issue(40, { labels: ['status:blocked'], events: [event('status:blocked', T(1))], comments: [comment(MALLORY, designHoldBody(), T(5))] })
    const forgedPlan = issue(50, { labels: ['status:blocked'], events: [event('status:blocked', T(1))], comments: [comment(MALLORY, planVerdict('needs-owner'), T(6))] })
    const forgedQuiz: QuizItem = { ...quizItem(80), comments: [comment(MALLORY, quizBody(), T(9))] }
    const { asks } = collectAsks({ items: [forgedPr, forgedReview, forgedHold, forgedPlan], quizItems: [forgedQuiz] })
    expect(asks.filter(a => a.kind === 'review' || a.kind === 'quiz')).toEqual([])
    expect(asks.find(a => a.sourceNumber === 10 || a.sourceNumber === 20)).toBeUndefined()

    const quotedHold = issue(41, { labels: ['status:blocked'], events: [event('status:blocked', T(1))], comments: [comment(BOT, designHoldBody().split('\n').map(l => `> ${l}`).join('\n'), T(5))] })
    const quotedQuiz: QuizItem = { ...quizItem(81), comments: [comment(GHA, quizBody().split('\n').map(l => `> ${l}`).join('\n'), T(9))] }
    const quotedPr = pr(12, { body: `> ${SIGNOFF_PREVIEW_MARKER}` })
    const q = collectAsks({ items: [quotedHold, quotedPr], quizItems: [quotedQuiz] }).asks
    expect(q.filter(a => a.kind === 'review' || a.kind === 'quiz')).toEqual([])
  })

  it('13. owner screens: a 📐 save answers a link card, never a design hold', () => {
    const first = sync({ items: [linkIssue()] })
    const save = comment(BOT, '📐 saved a drawing', T(10))
    const gone = sync({ items: [] }, first.cards, { [cardKey(first.cards[0]!)]: { comments: [save] } })
    expect(gone.cards[0]!.state).toBe('answered')

    const hold = designIssue()
    hold.comments.push(comment(BOT, '📐 saved a drawing', T(6)), comment(GHA, '🔄 the blocker this was waiting on (#12) has since closed — re-check whether this hold still applies.', T(7)))
    const a = sync({ items: [hold] })
    expect(a.cards).toHaveLength(1)
    expect(a.cards[0]).toMatchObject({ kind: 'review', state: 'waiting' })
    const b = sync({ items: [hold] }, a.cards)
    expect(b.plan.counts).toEqual({ created: 0, updated: 0, stale: 0, answered: 0 })
    expect(b.cards[0]!.state).toBe('waiting')
  })

  it('14. a failed gone read leaves the waiting card unchanged', () => {
    const first = sync({ items: [linkIssue()] })
    const next = sync({ items: [] }, first.cards, {})
    expect(next.plan.update).toEqual([])
    expect(next.cards[0]!.state).toBe('waiting')
  })

  it('15. a failed per-item read makes no ask and leaves its cards alone', () => {
    // (a) design hold unreadable: no card, existing waiting review card untouched
    const good = sync({ items: [designIssue()] })
    const bad = { ...designIssue(), comments: [], readError: true }
    const a = sync({ items: [bad] }, good.cards, {})
    expect(a.asks).toEqual([])
    expect(a.unreadable).toEqual([40])
    expect(a.plan.update).toEqual([])
    expect(a.plan.create).toEqual([])
    // (b) blocked issue whose events read failed: no ask, no empty key/askedAt
    const b = collectAsks({ items: [{ ...linkIssue(), events: [], readError: true }] })
    expect(b.asks).toEqual([])
    expect(b.unreadable).toEqual([60])
    // and if events are simply empty (no labeled event) the ask is dropped, never written empty
    const empty = collectAsks({ items: [{ ...linkIssue(), events: [] }] })
    expect(empty.asks).toEqual([])
    expect(empty.unreadable).toEqual([60])
    // (c) unreadable sign-off PR: no card on the PR and no link card on its issue
    const c = collectAsks({ items: [{ ...signoffPr(10, 11), readError: true }, linkIssue(11)] })
    expect(c.asks).toEqual([])
    // (d) once with readError, once without → first changes nothing, second yields the card
    const d1 = sync({ items: [{ ...designIssue(), comments: [], readError: true }] })
    expect(d1.plan.counts).toEqual({ created: 0, updated: 0, stale: 0, answered: 0 })
    const d2 = sync({ items: [designIssue()] }, d1.cards)
    expect(d2.plan.create.map(x => [x.kind, x.sourceNumber])).toEqual([['review', 40]])
  })

  it('16. a failed list read never marks a waiting card stale or answered', () => {
    const first = sync({ items: [linkIssue()] })
    const card = first.cards[0]!
    const next = sync({ items: [] }, first.cards, { [cardKey(card)]: { comments: [comment(OWNER, 'ok', T(10))] } }, false)
    expect(next.plan.update).toEqual([])
    expect(next.cards[0]!.state).toBe('waiting')
    // and with every list loaded but no reply → stale
    expect(sync({ items: [] }, first.cards, { [cardKey(card)]: { comments: [] } }).cards[0]!.state).toBe('stale')
  })
})

// ---------------------------------------------------------------- stuck rules (#3880)

const NOW = Date.parse(T(100))
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const BRANCH = 'epic/9-some-epic'
const conflictBody = (branch = BRANCH) => [
  EPIC_SYNC_MARKER,
  '> 🤖 **pi.dev harness** · epic branch sync',
  '',
  '## 🔴 Epic branch no longer merges cleanly with main',
  '',
  `Someone needs to merge \`main\` into \`${branch}\` and resolve the conflicts.`
].join('\n')

const quietTicket = (n = 100, h = 4, labels = ['work-this']) => issue(n, { labels, updatedAt: ago(h) })
const botDraft = (n = 110, h = 2, o: Partial<SyncItem> = {}) => pr(n, { draft: true, updatedAt: ago(h), body: `Closes #${n + 1}`, closesIssue: n + 1, ...o })
const conflictEpic = (n = 120, behindBy: number | null = 3, by: GhUser = BOT): EpicSyncItem => ({
  number: n, title: `Epic ${n}`, html_url: `https://github.com/o/r/issues/${n}`, behindBy,
  comments: [comment(OWNER, 'hi', ago(30)), comment(by, conflictBody(), ago(20))]
})

function stuckSync(input: { items?: SyncItem[], epicItems?: EpicSyncItem[], now?: number }, existing: ExistingCard[] = [], gone: Record<string, { comments: GhComment[] }> = {}) {
  const { asks, unreadable } = collectAsks({ items: input.items ?? [], epicItems: input.epicItems ?? [], now: input.now ?? NOW })
  const plan = planSync({ asks, unreadable, existing, gone, listsComplete: true })
  return { asks, plan, cards: apply(existing, plan) }
}
const stuckOf = (asks: Ask[]) => asks.map(a => [a.payload.stuck, a.sourceType, a.sourceNumber])
/** Every waiting card that left the asks gets an empty `since` read (no reply) → stale. */
const noReplies = (cards: ExistingCard[]) => Object.fromEntries(cards.map(c => [cardKey(c), { comments: [] as GhComment[] }]))

describe('cards-sync-core — stuck rules (#3880)', () => {
  it('S1. quiet ticket: 4 h → card; 2 h → none; active PR / blocked / traffic:waiting / epic / needs-merge PR → none', () => {
    expect(stuckOf(collectAsks({ items: [quietTicket()], now: NOW }).asks)).toEqual([['quiet', 'issue', 100]])
    for (const l of ['delegate', 'delegate-pi']) expect(collectAsks({ items: [quietTicket(100, 4, [l])], now: NOW }).asks).toHaveLength(1)
    expect(collectAsks({ items: [issue(100, { updatedAt: ago(4) })], now: NOW }).asks).toEqual([]) // no pipeline label
    expect(collectAsks({ items: [quietTicket(100, 2)], now: NOW }).asks).toEqual([])
    // its open PR (a human's, not a draft) was updated 1 h ago
    const active = pr(101, { user: MALLORY, updatedAt: ago(1), body: 'Closes #100', closesIssue: 100 })
    expect(collectAsks({ items: [active, quietTicket()], now: NOW }).asks).toEqual([])
    // blocked → #3777's link card only; traffic:waiting → nothing
    const blocked = { ...quietTicket(100, 4, ['work-this', 'status:blocked']), events: [event('status:blocked', ago(5))] }
    expect(collectAsks({ items: [blocked], now: NOW }).asks.map(a => a.payload.stuck)).toEqual([undefined])
    expect(collectAsks({ items: [quietTicket(100, 4, ['work-this', 'traffic:waiting'])], now: NOW }).asks).toEqual([])
    // an epic with work-this and a conflict comment → only the epic-sync card
    const epicTicket = quietTicket(120, 40, ['epic', 'work-this'])
    expect(stuckOf(collectAsks({ items: [epicTicket], epicItems: [conflictEpic(120)], now: NOW }).asks)).toEqual([['epic-sync', 'issue', 120]])
    // its open PR is labelled status:needs-merge (old) → the PR's review card, no quiet card
    const merge = pr(102, { user: MALLORY, updatedAt: ago(10), labels: ['status:needs-merge'], events: [event('status:needs-merge', ago(10))], body: 'Closes #100', closesIssue: 100 })
    expect(collectAsks({ items: [merge, quietTicket()], now: NOW }).asks.map(a => [a.kind, a.sourceNumber, a.payload.stuck])).toEqual([['review', 102, undefined]])
  })

  it('S2. the quiet card goes stale after new activity, and a later silence makes a new card', () => {
    const first = stuckSync({ items: [quietTicket(100, 4)] })
    expect(first.plan.counts.created).toBe(1)
    // new activity 1 h ago: no quiet ask → the old card is gone → stale
    const touched = issue(100, { labels: ['work-this'], updatedAt: ago(1) })
    const second = stuckSync({ items: [touched] }, first.cards, noReplies(first.cards))
    expect(second.cards.map(c => c.state)).toEqual(['stale'])
    // quiet again 5 h later → a new card keyed on the new updated_at
    const third = stuckSync({ items: [touched], now: NOW + 5 * 3_600_000 }, second.cards)
    expect(third.plan.counts.created).toBe(1)
    expect(third.plan.create[0]!.sourceCommentId).toBe(`quiet:${ago(1)}`)
    expect(third.cards.map(c => c.state)).toEqual(['stale', 'waiting'])
    // a later pmcp reply answers the waiting quiet card instead
    const live = third.cards[1]!
    const fourth = stuckSync({ items: [issue(100, { labels: ['work-this'], updatedAt: new Date(NOW + 6 * 3_600_000).toISOString() })], now: NOW + 6 * 3_600_000 }, third.cards,
      { [cardKey(live)]: { comments: [comment(OWNER, 'go on', new Date(NOW + 5.5 * 3_600_000).toISOString())] } })
    expect(fourth.cards[1]!.state).toBe('answered')
    expect(fourth.cards[1]!.answeredVia).toBe('github')
  })

  it('S3. bot draft PR: 2 h → one draft card and no quiet card on its issue; human draft / ready / sign-off hold → none', () => {
    const items = [botDraft(110, 2), quietTicket(111, 4)]
    expect(stuckOf(collectAsks({ items, now: NOW }).asks)).toEqual([['draft', 'pr', 110]])
    // updated 30 min ago → no draft card, and the active PR keeps its issue quiet-free
    expect(collectAsks({ items: [botDraft(110, 0.5), quietTicket(111, 4)], now: NOW }).asks).toEqual([])
    // a human's draft → no draft card (the human PR is 2 h old, so the ticket is still active)
    expect(collectAsks({ items: [botDraft(110, 2, { user: MALLORY })], now: NOW }).asks).toEqual([])
    // a `User` with the bot's login never counts
    expect(collectAsks({ items: [botDraft(110, 2, { user: { login: 'nuxt-harness[bot]', type: 'User' } })], now: NOW }).asks).toEqual([])
    // marked ready → the card goes stale
    const first = stuckSync({ items: [botDraft(110, 2)] })
    const ready = stuckSync({ items: [botDraft(110, 2, { draft: false })] }, first.cards, noReplies(first.cards))
    expect(ready.cards.map(c => c.state)).toEqual(['stale'])
    // covers: T3 — touched with no new commit (a bot comment) → stale; quiet again 2 h later → a new waiting card
    const touchedDraft = botDraft(110, 0.5)
    const touched = stuckSync({ items: [touchedDraft] }, first.cards, noReplies(first.cards))
    expect(touched.cards.map(c => c.state)).toEqual(['stale'])
    const later = NOW + 2 * 3_600_000
    const again = stuckSync({ items: [touchedDraft], now: later }, touched.cards)
    expect(again.plan.counts.created).toBe(1)
    expect(again.plan.create[0]!.sourceCommentId).toBe(`draft:sha110:${ago(0.5)}`)
    expect(again.cards.map(c => c.state)).toEqual(['stale', 'waiting'])
    expect(stuckCounts(again.asks).draft).toBe(1)
    // its issue still gets no quiet card while the draft card holds it
    expect(stuckOf(collectAsks({ items: [touchedDraft, quietTicket(111, 4)], now: later }).asks)).toEqual([['draft', 'pr', 110]])
    // a bot draft that is a sign-off hold → only #3777's review card
    const hold = botDraft(110, 2, { body: `Closes #111\n${SIGNOFF_PREVIEW_MARKER}` })
    expect(collectAsks({ items: [hold, quietTicket(111, 4)], now: NOW }).asks.map(a => [a.kind, a.sourceNumber, a.payload.stuck])).toEqual([['review', 110, undefined]])
    // needs-merge, or its issue blocked → no draft card
    expect(collectAsks({ items: [botDraft(110, 2, { labels: ['status:needs-merge'], events: [event('status:needs-merge', ago(3))] })], now: NOW }).asks.map(a => a.kind)).toEqual(['review'])
    const blockedIssue = issue(111, { labels: ['status:blocked'], events: [event('status:blocked', ago(3))] })
    expect(collectAsks({ items: [botDraft(110, 2), blockedIssue], now: NOW }).asks.map(a => [a.sourceNumber, a.payload.stuck])).toEqual([[111, undefined]])
  })

  it('S4. epic-sync: behind → card; caught up or branch gone → stale; sub-PR merge → still waiting; another user\'s marker → none', () => {
    const epic = conflictEpic(120, 3)
    const at = (behindBy: number | null) => ({ ...epic, behindBy }) // same comment thread, new compare result
    const first = stuckSync({ epicItems: [epic] })
    expect(stuckOf(first.asks)).toEqual([['epic-sync', 'issue', 120]])
    expect(first.asks[0]!.payload).toEqual({ stuck: 'epic-sync', branch: BRANCH })
    expect(first.asks[0]!.ask).toContain(BRANCH)
    // a sub-PR merge moved the branch but main's commit is still missing (behindBy still > 0) → waiting
    const subPr = stuckSync({ epicItems: [at(1)] }, first.cards, noReplies(first.cards))
    expect(subPr.plan.update).toEqual([])
    expect(subPr.cards.map(c => c.state)).toEqual(['waiting'])
    // main merged in (behind_by 0) → stale
    expect(stuckSync({ epicItems: [at(0)] }, first.cards, noReplies(first.cards)).cards.map(c => c.state)).toEqual(['stale'])
    // branch deleted (compare 404 → null) → stale
    expect(stuckSync({ epicItems: [at(null)] }, first.cards, noReplies(first.cards)).cards.map(c => c.state)).toEqual(['stale'])
    // the same marker in a comment by another user → no card
    expect(collectAsks({ items: [], epicItems: [conflictEpic(120, 3, MALLORY)], now: NOW }).asks).toEqual([])
    // an unreadable epic → no ask, its number skipped
    expect(collectAsks({ items: [], epicItems: [{ ...conflictEpic(120), readError: true }], now: NOW }).unreadable).toEqual([120])
  })

  it('S5. askedAt and sourceCommentId come from the named sources', () => {
    const epic = conflictEpic(120, 3)
    const c = epic.comments[1]!
    const { asks } = collectAsks({ items: [botDraft(110, 2, { headSha: 'deadbeef' }), quietTicket(100, 4)], epicItems: [epic], now: NOW })
    const by = Object.fromEntries(asks.map(a => [a.payload.stuck as string, a]))
    expect([by.quiet!.askedAt, by.quiet!.sourceCommentId]).toEqual([ago(4), `quiet:${ago(4)}`])
    expect(by.quiet!.title).toBe('Stuck: no pipeline activity on #100 for 4 h')
    expect([by.draft!.askedAt, by.draft!.sourceCommentId]).toEqual([ago(2), `draft:deadbeef:${ago(2)}`])
    expect([by['epic-sync']!.askedAt, by['epic-sync']!.sourceCommentId, by['epic-sync']!.link]).toEqual([c.created_at, String(c.id), c.html_url])
    for (const a of asks) expect(a.kind).toBe('issue')
  })

  it('S6. the morning of 13 Nov as fixtures → three cards', () => {
    const now = Date.parse('2026-11-13T08:00:00Z')
    // #3873: a bot draft PR left for a "Ready for review" tap
    const draftPr = pr(3873, { draft: true, updatedAt: '2026-11-12T21:14:00Z', body: 'Closes #3862', closesIssue: 3862, headSha: 'a1b2c3' })
    // #3813: a work-this ticket gone quiet after its run hit the time limit and posted nothing
    const timedOut = issue(3813, { labels: ['work-this', 'poc:status'], updatedAt: '2026-11-12T22:05:00Z', comments: [comment(BOT, '<!-- work-run:3813 -->\n> 🤖 Working this now', '2026-11-12T22:05:00Z')] })
    // #3193: an epic whose branch no longer merges with main
    const epic: EpicSyncItem = {
      number: 3193, title: 'Epic 3193', html_url: 'https://github.com/o/r/issues/3193', behindBy: 12,
      comments: [comment(BOT, conflictBody('epic/3193-x'), '2026-11-12T18:00:00Z')]
    }
    const { asks } = collectAsks({ items: [draftPr, timedOut, quietTicket(3862, 30)], epicItems: [epic], now })
    expect(stuckOf(asks)).toEqual([['draft', 'pr', 3873], ['quiet', 'issue', 3813], ['epic-sync', 'issue', 3193]])
    expect(stuckCounts(asks)).toEqual({ quiet: 1, draft: 1, epicSync: 1 })
  })
})

// #3785 — a review card names every shared package the PR changes.
describe('review card → payload.packages', () => {
  const ISSUE_BODY = [
    'Packages-approved: owner yes in chat 2026-11-11 14:49 — `packages/crouton-layout` for epic #3770',
    '',
    '## Hypothesis',
    'We think that...',
    '',
    '## 👤 For humans',
    'Adds two optional fields to how a layout is saved.',
    'Nothing else changes.',
    '',
    '## 🤖 For agents',
    '- details'
  ].join('\n')
  const reviewAsk = (files: SyncItem['files'], closedIssueBody: string | null = ISSUE_BODY) => {
    const { asks } = collectAsks({ items: [{ ...signoffPr(10, 11), files, closedIssueBody }] })
    expect(asks).toHaveLength(1)
    expect(asks[0]!.kind).toBe('review')
    return asks[0]!
  }
  const WHY = 'Adds two optional fields to how a layout is saved.\nNothing else changes.'
  const APPROVAL = 'owner yes in chat 2026-11-11 14:49 — `packages/crouton-layout` for epic #3770'

  it('a package file and a poc file → one entry for the package, with why and approval', () => {
    const a = reviewAsk([{ filename: 'packages/crouton-layout/app/x.ts' }, { filename: 'pocs/x/app.vue' }])
    expect(a.payload.packages).toEqual([{ name: 'crouton-layout', why: WHY, approval: APPROVAL }])
  })

  it('only pocs/ files → no packages key at all', () => {
    const a = reviewAsk([{ filename: 'pocs/x/app.vue' }, { filename: 'pocs/status/a.ts' }])
    expect(a.payload).not.toHaveProperty('packages')
  })

  it('files not read → no packages key', () => {
    expect(reviewAsk(undefined).payload).not.toHaveProperty('packages')
  })

  it('two packages → two entries, sorted', () => {
    const a = reviewAsk([{ filename: 'packages/crouton-layout/a.ts' }, { filename: 'packages/crouton-core/b.ts' }, { filename: 'packages/crouton-layout/c.ts' }])
    expect((a.payload.packages as any[]).map(p => p.name)).toEqual(['crouton-core', 'crouton-layout'])
  })

  it('closed issue has no 👤 section → why: null', () => {
    const a = reviewAsk([{ filename: 'packages/crouton-layout/a.ts' }], '## Hypothesis\nsomething\n\nPackages-approved: yes')
    expect(a.payload.packages).toEqual([{ name: 'crouton-layout', why: null, approval: 'yes' }])
  })

  it('the Packages-approved: line lands in approval; a fenced example does not count; PR body is the fallback', () => {
    const fenced = '```\nPackages-approved: example only\n```\n## 👤 For humans\nWhy.'
    const a = reviewAsk([{ filename: 'packages/crouton-core/a.ts' }], fenced)
    expect((a.payload.packages as any[])[0].approval).toBeNull()
    const { asks } = collectAsks({ items: [{ ...signoffPr(10, 11), body: `Closes #11\n\nPackages-approved: from the PR\n${SIGNOFF_PREVIEW_MARKER}`, files: [{ filename: 'packages/crouton-core/a.ts' }], closedIssueBody: null }] })
    expect((asks[0]!.payload.packages as any[])[0]).toEqual({ name: 'crouton-core', why: null, approval: 'from the PR' })
  })

  it('a file moved out of packages/crouton-layout still names crouton-layout', () => {
    const a = reviewAsk([{ filename: 'pocs/x.ts', previous_filename: 'packages/crouton-layout/x.ts' }])
    expect((a.payload.packages as any[]).map(p => p.name)).toEqual(['crouton-layout'])
  })

  it('keeps the rest of the payload (build-review card keeps its review key)', () => {
    const { asks } = collectAsks({ items: [{ ...buildOwnerPr(), files: [{ filename: 'packages/crouton-core/a.ts' }], closedIssueBody: null }] })
    expect(asks[0]!.payload).toMatchObject({ review: 'needs-owner', packages: [{ name: 'crouton-core' }] })
  })
})
