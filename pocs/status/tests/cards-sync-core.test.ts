import { describe, expect, it } from 'vitest'
import {
  SIGNOFF_PREVIEW_MARKER, cardKey, collectAsks, planSync,
  type Ask, type ExistingCard, type GhComment, type GhCommit, type GhEvent, type GhUser, type QuizItem, type SyncItem
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
