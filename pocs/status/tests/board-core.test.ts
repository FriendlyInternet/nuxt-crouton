import { describe, expect, it } from 'vitest'
import { boardFromLists, boardView, closesIssue, latestVerdict, stageOf, type BoardItem, type BoardPull } from '../server/utils/board-core'

// The Pipeline board's rules (#4349): which column a ticket is in (stageOf), what the card sync
// writes (boardFromLists) and what the board API shows (boardView). Pure — no D1, no GitHub.

const NOW = Date.parse('2026-11-20T12:00:00Z')
const HOUR = 3_600_000
const BOT = { login: 'nuxt-harness[bot]', type: 'Bot' }
const HUMAN = { login: 'pmcp', type: 'User' }
const item = (over: Partial<BoardItem> = {}): BoardItem => ({ number: 12, labels: '', ...over })
const none = new Set<number>()
const review = (verdict: string, sha: string, user = BOT, at = '2026-11-20T10:00:00Z') =>
  ({ id: `${verdict}-${sha}`, user, created_at: at, body: `<!-- build-review-verdict:${verdict} -->\n<!-- build-review-sha:${sha} -->\n> 🤖 build review` })
const pull = (over: Partial<BoardPull> = {}): BoardPull => ({ number: 40, body: 'Closes #12', labels: [], headSha: 'abc', base: 'main', comments: [], ...over })
const issue = (n: number, labels: string[]) => ({ number: n, title: `Issue ${n}`, html_url: `https://gh/${n}`, labels })

describe('stageOf — one column per ticket, first rule wins', () => {
  // covers: T1
  it('traffic:waiting + status:blocked → queued', () => {
    expect(stageOf(item({ labels: 'traffic:waiting,status:blocked,work-this' }), new Set([12]), NOW)).toBe('queued')
  })
  // covers: T1
  it('a waiting inbox card + plan:approved → you', () => {
    expect(stageOf(item({ labels: 'plan:approved' }), new Set([12]), NOW)).toBe('you')
  })
  // covers: T1
  it('closed 2 h ago → done; closed 30 h ago → not shown', () => {
    expect(stageOf(item({ labels: 'work-this', closedAt: new Date(NOW - 2 * HOUR) }), none, NOW)).toBe('done')
    expect(stageOf(item({ labels: 'work-this', closedAt: new Date(NOW - 30 * HOUR) }), none, NOW)).toBeNull()
  })
  // covers: T1
  it('status:to-test + a waiting delivery card → test', () => {
    expect(stageOf(item({ labels: 'status:to-test' }), new Set([12]), NOW)).toBe('test')
  })
  // covers: T1
  it('epic + work-this → not shown', () => {
    expect(stageOf(item({ labels: 'epic,work-this' }), new Set([12]), NOW)).toBeNull()
  })
  // covers: T1
  it('work-this alone → working; no pipeline label → not shown', () => {
    expect(stageOf(item({ labels: 'work-this' }), none, NOW)).toBe('working')
    expect(stageOf(item({ labels: 'type:fix' }), none, NOW)).toBeNull()
  })
  // covers: T1
  it('labels are issue ∪ PR labels', () => {
    expect(stageOf(item({ labels: '', prLabels: 'traffic:waiting' }), none, NOW)).toBe('queued')
  })
})

describe('build-review verdicts', () => {
  // covers: T3
  it('a bot go on head abc → verdict go / sha abc, stage review; new head def → still review; no-go on head → working', () => {
    const v = latestVerdict([review('go', 'abc')])
    expect(v).toEqual({ verdict: 'go', verdictSha: 'abc' })
    expect(stageOf(item({ labels: 'work-this', prNumber: 40, prHeadSha: 'abc', ...v }), none, NOW)).toBe('review')
    expect(stageOf(item({ labels: 'work-this', prNumber: 40, prHeadSha: 'def', ...v }), none, NOW)).toBe('review')
    const nogo = latestVerdict([review('go', 'abc', BOT, '2026-11-20T09:00:00Z'), review('no-go', 'def')])
    expect(nogo).toEqual({ verdict: 'no-go', verdictSha: 'def' })
    expect(stageOf(item({ labels: 'work-this', prNumber: 40, prHeadSha: 'def', ...nogo }), none, NOW)).toBe('working')
  })
  // covers: T3
  it('the same markers from a non-bot account change nothing', () => {
    expect(latestVerdict([review('no-go', 'abc', HUMAN)])).toEqual({ verdict: null, verdictSha: null })
    const plan = boardFromLists({ issues: [issue(12, ['work-this'])], pulls: [pull({ comments: [review('no-go', 'abc', HUMAN)] })], existing: [], waiting: none, complete: true, now: NOW })
    expect(plan.create[0]).toMatchObject({ verdict: null, stage: 'review' })
  })
})

describe('boardFromLists — what the card sync writes', () => {
  // covers: T2
  it('a PR whose body says Closes #12 updates row 12; a PR closing nothing changes nothing', () => {
    const existing = [{ id: 'r12', ...item({ labels: 'work-this', stage: 'working', stageSince: new Date(NOW - HOUR), order: NOW - HOUR }) }]
    const plan = boardFromLists({ issues: [issue(12, ['work-this'])], pulls: [pull(), pull({ number: 41, body: 'no closing line' })], existing, waiting: none, complete: true, now: NOW })
    expect(plan.create).toEqual([])
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]).toMatchObject({ id: 'r12', patch: { prNumber: 40, prHeadSha: 'abc', prBase: 'main', stage: 'review' } })
    expect(closesIssue('Fixes #7')).toBe(7)
    expect(closesIssue('Refs #7')).toBeNull()
  })
  // covers: T2
  it('issue labels never overwrite prLabels', () => {
    const existing = [{ id: 'r12', ...item({ labels: 'work-this', prNumber: 40, prHeadSha: 'abc', prBase: 'main', prLabels: 'status:needs-merge', stage: 'review', stageSince: new Date(NOW - HOUR), order: 1 }) }]
    const plan = boardFromLists({ issues: [issue(12, ['work-this', 'poc:status'])], pulls: [pull({ labels: ['status:needs-merge'] })], existing, waiting: none, complete: true, now: NOW })
    expect(plan.update[0]!.patch).toEqual({ labels: 'work-this,poc:status', title: 'Issue 12', url: 'https://gh/12' })
    expect(plan.update[0]!.patch).not.toHaveProperty('prLabels')
  })
  // covers: T2
  it('an issue with no pipeline label and no row writes nothing; an epic is never written', () => {
    const plan = boardFromLists({ issues: [issue(12, ['status:blocked']), issue(13, ['epic', 'work-this'])], pulls: [], existing: [], waiting: none, complete: true, now: NOW })
    expect(plan).toEqual({ create: [], update: [], remove: [] })
  })
  // covers: T4
  it('stageSince is unchanged when the stage is unchanged, and moves when it changes', () => {
    const since = new Date(NOW - 5 * HOUR)
    const existing = [{ id: 'r12', ...item({ title: 'Issue 12', url: 'https://gh/12', labels: 'work-this', stage: 'working', stageSince: since, order: since.getTime() }) }]
    const same = boardFromLists({ issues: [issue(12, ['work-this'])], pulls: [], existing, waiting: none, complete: true, now: NOW })
    expect(same.update).toEqual([]) // nothing changed → no write at all
    const moved = boardFromLists({ issues: [issue(12, ['work-this', 'traffic:waiting'])], pulls: [], existing, waiting: none, complete: true, now: NOW })
    expect(moved.update[0]!.patch).toMatchObject({ stage: 'queued', stageSince: new Date(NOW), order: NOW })
  })
  // covers: T2
  it('a PR whose comments failed to read keeps its stored verdict', () => {
    const existing = [{ id: 'r12', ...item({ labels: 'work-this', prNumber: 40, prHeadSha: 'abc', verdict: 'no-go', verdictSha: 'abc', stage: 'working', stageSince: new Date(NOW - HOUR), order: 1 }) }]
    const plan = boardFromLists({ issues: [issue(12, ['work-this'])], pulls: [pull({ readError: true })], existing, waiting: none, complete: true, now: NOW })
    expect(plan.update[0]?.patch ?? {}).not.toHaveProperty('verdict')
  })
})

describe('boardView — the column is worked out at read time', () => {
  const row = (over: Partial<BoardItem> = {}) => ({ id: 'r12', ...item({ title: 'Issue 12', url: 'https://gh/12', labels: 'plan:approved,pkg:crouton-core', stage: 'working', stageSince: new Date(NOW - 3 * HOUR), order: NOW - 3 * HOUR, ...over }) })
  const card = (over: Record<string, unknown> = {}) => ({ sourceType: 'issue', sourceNumber: 12, state: 'waiting', askedAt: new Date(NOW - HOUR), ...over })

  // covers: T4
  it('a waiting card puts the row in "you" with time from askedAt; once answered it moves back, with no row write', () => {
    const rows = [row()]
    const you = boardView(rows, [card()], NOW)
    expect(you).toEqual([expect.objectContaining({ number: 12, column: 'you', since: new Date(NOW - HOUR).toISOString(), pkg: 'crouton-core' })])
    const back = boardView(rows, [card({ state: 'answered' })], NOW)
    expect(back[0]).toMatchObject({ column: 'working', since: new Date(NOW - 3 * HOUR).toISOString() })
  })
  // covers: T4
  it('a PR card counts for the row whose prNumber it is', () => {
    expect(boardView([row({ prNumber: 40, prHeadSha: 'abc' })], [card({ sourceType: 'pr', sourceNumber: 40 })], NOW)[0]!.column).toBe('you')
  })
  // covers: T4
  it('a column that differs from the stored stage shows no time; rows with no column are left out', () => {
    const v = boardView([row({ stage: 'you' }), { id: 'r13', number: 13, labels: 'type:fix' }], [], NOW)
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ column: 'working', since: null })
  })
  // covers: T4
  it('the red check shows only when CI went red on the current head', () => {
    expect(boardView([row({ prNumber: 40, prHeadSha: 'abc', checksRed: true, checksSha: 'abc' })], [], NOW)[0]!.checksRed).toBe(true)
    expect(boardView([row({ prNumber: 40, prHeadSha: 'def', checksRed: true, checksSha: 'abc' })], [], NOW)[0]!.checksRed).toBe(false)
  })
})
