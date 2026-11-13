import { describe, it, expect, vi } from 'vitest'
import { cardView, loadInbox, nothingWaits, submitAnswer, validateAnswer, waitingCards, type InboxCard, type InboxLoadState } from '../app/utils/inbox-core'

const card = (over: Partial<InboxCard> & { id: string }): InboxCard => ({
  kind: 'review',
  state: 'waiting',
  askedAt: '2026-11-01T00:00:00Z',
  title: `Card ${over.id}`,
  ask: 'Check it',
  recommendation: null,
  link: `https://github.com/x/y/issues/${over.id}`,
  payload: null,
  sourceType: 'issue',
  sourceNumber: 1,
  ...over
})

const fixtures: InboxCard[] = [
  card({ id: 'review', kind: 'review', askedAt: new Date('2026-11-02T00:00:00Z') }),
  card({ id: 'edit', kind: 'review', askedAt: '2026-11-05T00:00:00Z', payload: { editUrl: 'https://edit.example/1' } }),
  card({ id: 'issue', kind: 'issue', askedAt: Date.parse('2026-11-04T00:00:00Z') }),
  card({ id: 'quiz', kind: 'quiz', askedAt: '2026-11-01T00:00:00Z' }),
  card({ id: 'delivery', kind: 'delivery', askedAt: '2026-11-03T00:00:00Z' }),
  card({ id: 'answered', state: 'answered', askedAt: '2026-11-09T00:00:00Z' }),
  card({ id: 'stale', state: 'stale', askedAt: '2026-11-08T00:00:00Z' })
]

describe('waitingCards', () => {
  it('keeps only waiting cards, newest askedAt first, across Date / ISO / number', () => {
    expect(waitingCards(fixtures).map(c => c.id)).toEqual(['edit', 'issue', 'delivery', 'review', 'quiz'])
  })
  it('does not mutate its input', () => {
    const copy = [...fixtures]
    waitingCards(fixtures)
    expect(fixtures).toEqual(copy)
  })
  it('handles a missing list', () => {
    expect(waitingCards(null)).toEqual([])
  })
})

describe('cardView', () => {
  const byId = (id: string) => fixtures.find(c => c.id === id)!
  it('maps each kind to its component', () => {
    expect(cardView(byId('review'))).toBe('review')
    expect(cardView(byId('edit'))).toBe('edit')
    expect(cardView(byId('issue'))).toBe('issue')
    expect(cardView(byId('quiz'))).toBe('placeholder')
    expect(cardView(byId('delivery'))).toBe('placeholder')
    expect(cardView(card({ id: 'c', kind: 'choice' }))).toBe('placeholder')
    expect(cardView(card({ id: 'u', kind: 'whatever' }))).toBe('placeholder')
  })
  it('an edit-kind card needs an editUrl', () => {
    expect(cardView(card({ id: 'e1', kind: 'edit', payload: { editUrl: 'https://e' } }))).toBe('edit')
    expect(cardView(card({ id: 'e2', kind: 'edit' }))).toBe('placeholder')
  })
})

describe('validateAnswer', () => {
  it('accepts ok and not-ok with a note, refuses the rest', () => {
    expect(validateAnswer({ verdict: 'ok' })).toBeNull()
    expect(validateAnswer({ verdict: 'not-ok', note: 'fix x' })).toBeNull()
    expect(validateAnswer({ verdict: 'not-ok', note: '' })).toBe('Add a short note first.')
    expect(validateAnswer({ verdict: 'lgtm' })).toBeTruthy()
  })
})

describe('submitAnswer', () => {
  const list = () => waitingCards(fixtures)

  it('removes the card on a 2xx and returns no error', async () => {
    const send = vi.fn().mockResolvedValue({ status: 200 })
    const res = await submitAnswer({ cards: list(), cardId: 'review', input: { verdict: 'ok' }, send })
    expect(send).toHaveBeenCalledWith('review', { verdict: 'ok', note: '' })
    expect(res.error).toBeNull()
    expect(res.cards.map(c => c.id)).not.toContain('review')
    expect(res.cards).toHaveLength(list().length - 1)
  })

  it('keeps every card and returns the server error on a non-2xx', async () => {
    const send = vi.fn().mockResolvedValue({ status: 500, error: 'GitHub 500' })
    const res = await submitAnswer({ cards: list(), cardId: 'review', input: { verdict: 'ok' }, send })
    expect(res.error).toBe('GitHub 500')
    expect(res.cards.map(c => c.id)).toEqual(list().map(c => c.id))
  })

  it('keeps every card and returns an error when send throws', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network down'))
    const res = await submitAnswer({ cards: list(), cardId: 'review', input: { verdict: 'ok' }, send })
    expect(res.error).toBeTruthy()
    expect(res.cards.map(c => c.id)).toEqual(list().map(c => c.id))
  })

  it('refuses a not-ok with a blank note without calling send', async () => {
    const send = vi.fn()
    const res = await submitAnswer({ cards: list(), cardId: 'review', input: { verdict: 'not-ok', note: '  ' }, send })
    expect(res.error).toBe('Add a short note first.')
    expect(send).toHaveBeenCalledTimes(0)
    expect(res.cards).toHaveLength(list().length)
  })
})

describe('loadInbox', () => {
  const deferred = () => {
    let resolve!: (v?: unknown) => void
    let reject!: (e: unknown) => void
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
  const flush = () => new Promise(r => setTimeout(r, 0))
  const harness = () => {
    const state: InboxLoadState = { cards: [], loading: true, refreshing: false, loadError: null, syncError: null }
    const update = (patch: Partial<InboxLoadState>) => Object.assign(state, patch)
    return { state, update }
  }
  const stored = [card({ id: 'a', askedAt: '2026-11-01T00:00:00Z' })]
  const fresh = [card({ id: 'a', askedAt: '2026-11-01T00:00:00Z' }), card({ id: 'b', askedAt: '2026-11-02T00:00:00Z' })]

  it('shows the stored list before sync resolves', async () => {
    const { state, update } = harness()
    const sync = deferred()
    const list = vi.fn().mockResolvedValueOnce(stored).mockResolvedValueOnce(fresh)
    const done = loadInbox({ list, sync: () => sync.promise, update })
    await flush()
    expect(state.cards.map(c => c.id)).toEqual(['a'])
    expect(state.loading).toBe(false)
    expect(state.refreshing).toBe(true)
    expect(list).toHaveBeenCalledTimes(1)
    sync.resolve()
    await done
  })

  it('fetches the list a second time after sync resolves and replaces the cards', async () => {
    const { state, update } = harness()
    const list = vi.fn().mockResolvedValueOnce(stored).mockResolvedValueOnce(fresh)
    await loadInbox({ list, sync: async () => ({}), update })
    expect(list).toHaveBeenCalledTimes(2)
    expect(state.cards.map(c => c.id)).toEqual(['b', 'a'])
    expect(state.refreshing).toBe(false)
    expect(state.syncError).toBeNull()
  })

  it('a sync that rejects leaves the first list in place and reports the error', async () => {
    const { state, update } = harness()
    const list = vi.fn().mockResolvedValue(stored)
    await loadInbox({ list, sync: () => Promise.reject({ data: { statusMessage: 'rate limited' } }), update })
    expect(list).toHaveBeenCalledTimes(1)
    expect(state.cards.map(c => c.id)).toEqual(['a'])
    expect(state.syncError).toBe('Could not refresh from GitHub: rate limited')
    expect(state.refreshing).toBe(false)
    expect(state.loadError).toBeNull()
  })

  it('a failed list load reports the load error', async () => {
    const { state, update } = harness()
    const list = vi.fn().mockRejectedValue(new Error('boom'))
    const sync = deferred()
    const done = loadInbox({ list, sync: () => sync.promise, update })
    await flush()
    expect(state.loadError).toBe('boom')
    expect(state.loading).toBe(false)
    sync.reject(new Error('down'))
    await done
    expect(state.syncError).toBe('Could not refresh from GitHub: down')
  })

  it('"nothing waits" is false while sync is pending and true once it finishes empty', async () => {
    const { state, update } = harness()
    const sync = deferred()
    const list = vi.fn().mockResolvedValue([])
    const done = loadInbox({ list, sync: () => sync.promise, update })
    await flush()
    expect(state.loading).toBe(false)
    expect(state.cards).toEqual([])
    expect(nothingWaits(state)).toBe(false)
    sync.resolve()
    await done
    expect(nothingWaits(state)).toBe(true)
  })

  it('"nothing waits" is true after a failed sync with an empty list', async () => {
    const { state, update } = harness()
    await loadInbox({ list: async () => [], sync: () => Promise.reject(new Error('x')), update })
    expect(nothingWaits(state)).toBe(true)
  })
})
