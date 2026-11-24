import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { createStorage } from 'unstorage'
import memory from 'unstorage/drivers/memory'
import { boardMock, boardQueries, gh, resetGh } from './helpers/gh-routes'
import { DIRTY_KEY, handleWebhook } from '../server/utils/webhook-core'
import { boardView, type BoardCard } from '../server/utils/board-core'
import type { BoardWebhookDeps } from '../server/utils/board-webhook'

// #4350: the GitHub webhook writes the Pipeline board live. Drives the REAL handleWebhook (signature,
// payload parsing, the workflow_run branch) → the REAL writeBoardEvent → the REAL boardFromEvent →
// the REAL applyBoard of the card sync. Only the generated D1 queries are stubbed (no D1 in vitest),
// by the in-memory `pipeline_items` table the card-sync tests use (tests/helpers/gh-routes.ts), and
// findOwnerTeam (it reads the auth tables in D1).

vi.mock('../layers/pipeline/collections/items/server/database/queries', () => boardMock())
vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getAllInboxCards: vi.fn(async () => []),
  createInboxCard: vi.fn(),
  updateInboxCard: vi.fn()
}))

const SECRET = 's3cret'
const REPO = 'FriendlyInternet/nuxt-crouton'
const NOW = Date.parse('2026-11-24T10:00:00Z')
const BOT = { login: 'nuxt-harness[bot]', type: 'Bot' }
const HUMAN = { login: 'pmcp', type: 'User' }
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`

let cards: BoardCard[]
const findOwnerTeam = vi.fn(async (email: string) => (email === 'owner@x' ? { teamId: 'team1', userId: 'u1' } : null))

async function deps(over: Partial<BoardWebhookDeps> = {}): Promise<BoardWebhookDeps> {
  vi.stubGlobal('defineCachedFunction', (fn: unknown) => fn)
  const { applyBoard } = await import('../server/utils/cards-sync-run')
  return {
    findOwnerTeam,
    rows: async () => (await boardQueries.getAllPipelineItems()) as any,
    cards: async () => cards,
    apply: applyBoard,
    ...over
  }
}

/** Sends one signed event through the real handler, the board writer wired as webhook.post.ts does. */
async function send(event: string, payload: Record<string, unknown>, opts: { sig?: string, d?: BoardWebhookDeps, board?: (e: any) => Promise<unknown> } = {}) {
  const { writeBoardEvent } = await import('../server/utils/board-webhook')
  const kv = createStorage({ driver: memory() })
  const raw = JSON.stringify({ repository: { full_name: REPO }, ...payload })
  const d = opts.d ?? await deps()
  const board = opts.board ?? vi.fn((e: any) => writeBoardEvent(e, 'owner@x', d, NOW))
  const res = await handleWebhook({
    headers: { 'x-github-event': event, 'x-hub-signature-256': opts.sig ?? sign(raw) },
    rawBody: raw, secret: SECRET, repo: REPO, store: kv, board, now: NOW
  })
  return { res, kv, board }
}

const issue = (n: number, labels: string[], over: Record<string, unknown> = {}) =>
  ({ number: n, title: `Issue ${n}`, html_url: `https://gh/${n}`, state: 'open', labels: labels.map(name => ({ name })), ...over })
const pr = (n: number, over: Record<string, unknown> = {}) =>
  ({ number: n, body: 'Closes #12', state: 'open', labels: [{ name: 'poc:status' }], head: { sha: 'abc' }, base: { ref: 'main' }, ...over })
const row = (over: Record<string, unknown> = {}) => ({
  id: 'row1', number: 12, title: 'Issue 12', url: 'https://gh/12', labels: 'work-this', prLabels: null, prNumber: null, prHeadSha: null,
  checksRed: false, checksSha: null, verdict: null, verdictSha: null, closedAt: null, stage: 'working', stageSince: new Date(NOW - 3_600_000), order: NOW - 3_600_000, ...over
})
const reviewComment = (verdict: string, sha: string, user = BOT) =>
  ({ id: 1, user, created_at: '2026-11-24T09:00:00Z', body: `<!-- build-review-verdict:${verdict} -->\n<!-- build-review-sha:${sha} -->\n> 🤖 build review` })
const ciRun = (conclusion: string, over: Record<string, unknown> = {}) =>
  ({ action: 'completed', workflow_run: { name: 'CI', head_sha: 'abc', conclusion, pull_requests: [{ number: 40 }], ...over } })
const columnOf = () => boardView(gh.board, cards, NOW).find(r => r.number === 12)?.column ?? null

beforeEach(() => {
  resetGh()
  cards = []
  vi.clearAllMocks()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('webhook → board (issue / PR / comment events)', () => {
  // covers: T4
  it('a bad signature writes nothing: the board writer is never called', async () => {
    const board = vi.fn()
    const { res, kv } = await send('issues', { action: 'labeled', issue: issue(12, ['work-this']) }, { sig: sign('x', 'other'), board })
    expect(res).toEqual({ status: 401 })
    expect(board).not.toHaveBeenCalled()
    expect(await kv.getItem(DIRTY_KEY)).toBeNull()
  })

  // covers: T4
  it('a handled event calls the board update once and still marks dirty', async () => {
    const { res, kv, board } = await send('issues', { action: 'labeled', issue: issue(12, ['work-this']) })
    expect(res).toEqual({ status: 202 })
    expect(board).toHaveBeenCalledTimes(1)
    expect(await kv.getItem(DIRTY_KEY)).toBe(new Date(NOW).toISOString())
    expect(gh.board).toHaveLength(1)
    expect(gh.board[0]).toMatchObject({ number: 12, title: 'Issue 12', url: 'https://gh/12', labels: 'work-this', stage: 'working', teamId: 'team1', owner: 'u1' })
  })

  // covers: T4
  it('a failed board write still answers 202 (and is logged)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    boardQueries.createPipelineItem.mockRejectedValueOnce(new Error('D1 down'))
    const { res, kv } = await send('issues', { action: 'labeled', issue: issue(12, ['work-this']) })
    expect(res).toEqual({ status: 202 })
    expect(await kv.getItem(DIRTY_KEY)).toBe(new Date(NOW).toISOString())
    expect(err).toHaveBeenCalledWith('[webhook] board write failed', expect.any(Error))
    err.mockRestore()
  })

  // covers: T4
  it('an event for an issue with no pipeline label and no row → no row written', async () => {
    const { res } = await send('issues', { action: 'opened', issue: issue(12, ['type:feat']) })
    expect(res).toEqual({ status: 202 })
    expect(gh.boardWrites).toEqual([])
  })

  // covers: T2
  it('PR folding: a PR whose body says Closes #12 updates item 12; a PR closing nothing changes nothing', async () => {
    gh.board = [row()]
    await send('pull_request', { action: 'opened', pull_request: pr(40) })
    expect(gh.board[0]).toMatchObject({ prNumber: 40, prHeadSha: 'abc', prBase: 'main', prLabels: 'poc:status', stage: 'review' })
    gh.boardWrites = []
    await send('pull_request', { action: 'opened', pull_request: pr(41, { body: 'no closing line' }) })
    expect(gh.boardWrites).toEqual([])
  })

  // covers: T2
  it('an issue labeled event leaves prLabels as they were', async () => {
    gh.board = [row({ prNumber: 40, prHeadSha: 'abc', prLabels: 'poc:status', stage: 'review' })]
    await send('issues', { action: 'labeled', issue: issue(12, ['work-this', 'pkg:x']) })
    expect(gh.board[0]).toMatchObject({ labels: 'work-this,pkg:x', prLabels: 'poc:status', prNumber: 40 })
  })

  // covers: T3
  it('verdict: a bot go on the head → review; a later synchronize to def → still review; no-go on the head → working', async () => {
    gh.board = [row({ prNumber: 40, prHeadSha: 'abc', stage: 'review' })]
    await send('issue_comment', { action: 'created', issue: { number: 40, pull_request: {} }, comment: reviewComment('go', 'abc') })
    expect(gh.board[0]).toMatchObject({ verdict: 'go', verdictSha: 'abc' })
    expect(columnOf()).toBe('review')
    await send('pull_request', { action: 'synchronize', pull_request: pr(40, { head: { sha: 'def' } }) })
    expect(gh.board[0]).toMatchObject({ prHeadSha: 'def', verdictSha: 'abc' })
    expect(columnOf()).toBe('review')
    await send('issue_comment', { action: 'created', issue: { number: 40, pull_request: {} }, comment: reviewComment('no-go', 'def') })
    expect(gh.board[0]).toMatchObject({ verdict: 'no-go', verdictSha: 'def', stage: 'working' })
    expect(columnOf()).toBe('working')
  })

  // covers: T3
  it('the same markers from a non-bot account change nothing', async () => {
    gh.board = [row({ prNumber: 40, prHeadSha: 'abc', stage: 'review' })]
    await send('issue_comment', { action: 'created', issue: { number: 40, pull_request: {} }, comment: reviewComment('no-go', 'abc', HUMAN) })
    expect(gh.boardWrites).toEqual([])
  })

  // covers: T6
  it('a PR-closed webhook clears the PR fields, so the stage falls back to the labels', async () => {
    gh.board = [row({ prNumber: 40, prHeadSha: 'abc', prLabels: 'poc:status', verdict: 'go', verdictSha: 'abc', checksRed: true, checksSha: 'abc', stage: 'review' })]
    await send('pull_request', { action: 'closed', pull_request: pr(40, { state: 'closed' }) })
    expect(gh.board[0]).toMatchObject({ prNumber: null, prHeadSha: null, prLabels: null, verdict: null, verdictSha: null, checksRed: false, checksSha: null, stage: 'working' })
  })

  // covers: T7
  it('stageSince stays when a write does not change the stage', async () => {
    const since = new Date(NOW - 3_600_000)
    gh.board = [row({ stageSince: since })]
    await send('issues', { action: 'edited', issue: issue(12, ['work-this'], { title: 'Renamed' }) })
    expect(gh.board[0].title).toBe('Renamed')
    expect(gh.board[0].stageSince).toBe(since)
    expect(gh.boardWrites[0].data).not.toHaveProperty('stageSince')
  })

  // covers: T1
  it('a closed issue event → done today; a closed issue with no row adds none', async () => {
    gh.board = [row()]
    await send('issues', { action: 'closed', issue: issue(12, ['work-this'], { state: 'closed', closed_at: '2026-11-24T09:00:00Z' }) })
    expect(gh.board[0].stage).toBe('done')
    gh.boardWrites = []
    await send('issues', { action: 'closed', issue: issue(13, ['work-this'], { state: 'closed', closed_at: '2026-11-24T09:00:00Z' }) })
    expect(gh.boardWrites).toEqual([])
  })

  // covers: T7
  it('a waiting inbox card on the PR puts the row in "you" at write time', async () => {
    gh.board = [row({ prNumber: 40, prHeadSha: 'abc', stage: 'review' })]
    cards = [{ sourceType: 'pr', sourceNumber: 40, state: 'waiting', askedAt: NOW - 60_000 }]
    await send('pull_request', { action: 'labeled', pull_request: pr(40, { labels: [{ name: 'poc:status' }, { name: 'x' }] }) })
    expect(gh.board[0].stage).toBe('you')
  })

  // covers: T4
  it('no owner team → the write fails, the webhook still answers 202', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { writeBoardEvent } = await import('../server/utils/board-webhook')
    const d = await deps()
    const { res } = await send('issues', { action: 'labeled', issue: issue(12, ['work-this']) }, { board: e => writeBoardEvent(e, '', d, NOW) })
    expect(res).toEqual({ status: 202 })
    expect(gh.board).toEqual([])
    err.mockRestore()
  })
})

describe('webhook → board (workflow_run, the red-check badge)', () => {
  const prRow = () => row({ prNumber: 40, prHeadSha: 'abc', stage: 'review' })

  // covers: T5
  it('CI completed failure on the item\'s PR head → checksRed true, and the dirty flag is NOT set', async () => {
    gh.board = [prRow()]
    const { res, kv } = await send('workflow_run', ciRun('failure'))
    expect(res).toEqual({ status: 202 })
    expect(gh.board[0]).toMatchObject({ checksRed: true, checksSha: 'abc' })
    expect(await kv.getItem(DIRTY_KEY)).toBeNull()
    expect(boardView(gh.board, cards, NOW)[0].checksRed).toBe(true)
  })

  // covers: T5
  it('success → false', async () => {
    gh.board = [row({ prNumber: 40, prHeadSha: 'abc', stage: 'review', checksRed: true, checksSha: 'abc' })]
    await send('workflow_run', ciRun('success'))
    expect(gh.board[0]).toMatchObject({ checksRed: false, checksSha: 'abc' })
  })

  // covers: T5
  it('cancelled → unchanged; another workflow → nothing; a run on an older head → nothing', async () => {
    gh.board = [row({ prNumber: 40, prHeadSha: 'abc', stage: 'review', checksRed: true, checksSha: 'abc' })]
    await send('workflow_run', ciRun('cancelled'))
    await send('workflow_run', ciRun('failure', { name: 'E2E' }))
    await send('workflow_run', ciRun('success', { head_sha: 'old' }))
    await send('workflow_run', { action: 'requested', workflow_run: { name: 'CI', head_sha: 'abc', conclusion: null, pull_requests: [{ number: 40 }] } })
    expect(gh.boardWrites).toEqual([])
    expect(gh.board[0]).toMatchObject({ checksRed: true, checksSha: 'abc' })
  })

  // covers: T5
  it('a later synchronize (new PR head) → checksRed false', async () => {
    gh.board = [prRow()]
    await send('workflow_run', ciRun('failure'))
    expect(gh.board[0].checksRed).toBe(true)
    await send('pull_request', { action: 'synchronize', pull_request: pr(40, { head: { sha: 'def' } }) })
    expect(gh.board[0]).toMatchObject({ checksRed: false, prHeadSha: 'def' })
  })
})
