import { describe, it, expect } from 'vitest'
import {
  currentStatus,
  recentStatuses,
  unreadStatusCount,
  markAllStatusSeen,
  mutationStatus,
  mergeTeamEvents,
  dropTeamEvents,
  STATUS_RECENT_MAX,
  type StatusMessage,
} from '../status-feed'

const msg = (over: Partial<StatusMessage> = {}): StatusMessage => ({
  id: 'a',
  text: 'x',
  type: 'success',
  timestamp: 1000,
  seen: false,
  ...over,
})

// minimal translator mirroring the en.json strings
const t = (key: string, p: Record<string, unknown> = {}) => {
  const map: Record<string, string> = {
    'statusBar.createdNamed': `${p.user} created ${p.label} "${p.name}"`,
    'statusBar.created': `${p.user} created a ${p.label}`,
    'statusBar.savedNamed': `${p.user} saved "${p.name}"`,
    'statusBar.saved': `${p.user} saved the ${p.label}`,
    'statusBar.deleted': `${p.user} deleted a ${p.label}`,
    'statusBar.deletedMultiple': `${p.user} deleted ${p.count} ${p.label}s`,
    'statusBar.defaultUser': 'You',
  }
  return map[key] ?? key
}

describe('currentStatus', () => {
  it('shows a success until 4s have passed, not before', () => {
    const m = msg({ timestamp: 1000 })
    expect(currentStatus([m], 4999)).toBe(m)
    expect(currentStatus([m], 5000)).toBeUndefined()
  })

  it('keeps an error until dismissed (never expires)', () => {
    const m = msg({ type: 'error' })
    expect(currentStatus([m], 1000 + 10 * 60_000)).toBe(m)
  })

  it('a newer message replaces current', () => {
    const older = msg({ id: 'old' })
    const newer = msg({ id: 'new', timestamp: 2000 })
    expect(currentStatus([newer, older], 2500)?.id).toBe('new')
  })
})

describe('recentStatuses', () => {
  it('caps at 5, newest first', () => {
    const list = Array.from({ length: 8 }, (_, i) => msg({ id: String(8 - i) }))
    const recent = recentStatuses(list)
    expect(recent).toHaveLength(5)
    expect(recent[0]!.id).toBe('8')
  })
})

describe('unreadStatusCount', () => {
  it('counts only unseen warnings/errors until markAllSeen', () => {
    const list = [
      msg({ id: '1', type: 'success' }),
      msg({ id: '2', type: 'info' }),
      msg({ id: '3', type: 'warning' }),
      msg({ id: '4', type: 'error' }),
    ]
    expect(unreadStatusCount(list)).toBe(2)
    expect(unreadStatusCount(markAllStatusSeen(list))).toBe(0)
  })
})

describe('mutationStatus', () => {
  it('maps update to "<name> saved X"', () => {
    expect(mutationStatus({ operation: 'update', collection: 'shopProducts', itemName: 'Mug', userName: 'Maarten' }, t).text)
      .toBe('Maarten saved "Mug"')
  })

  it('maps create and delete to matching verbs', () => {
    expect(mutationStatus({ operation: 'create', collection: 'shopProducts', userName: 'Maarten' }, t).text)
      .toBe('Maarten created a product')
    expect(mutationStatus({ operation: 'delete', collection: 'shopProducts', itemIds: ['1', '2'] }, t).text)
      .toBe('You deleted 2 products')
  })
})

describe('mergeTeamEvents', () => {
  const ev = (id: string, ts: number, over: Record<string, unknown> = {}) => ({
    id, timestamp: new Date(ts).toISOString(), operation: 'update', collectionName: 'shopProducts', userId: 'u1', userName: 'Bo Lee', ...over,
  })

  it('returns local history unchanged when there are no events', () => {
    const h = [msg({ id: 'a', timestamp: 3000 }), msg({ id: 'b', timestamp: 2000 })]
    expect(mergeTeamEvents(h, [], t, 'u1').map(m => m.id)).toEqual(['a', 'b'])
  })

  it('merges nothing without a current user', () => {
    expect(mergeTeamEvents([], [ev('e1', 100000)], t)).toEqual([])
  })

  it('merges own events newest first, shown as "You"', () => {
    const out = mergeTeamEvents([msg({ id: 'a', timestamp: 1000 })], [ev('e1', 100000)], t, 'u1')
    expect(out.map(m => m.id)).toEqual(['event-e1', 'a'])
    expect(out[0]!.text).toContain('You')
    expect(out[0]!.text).not.toContain('Bo')
  })

  it("drops another user's events", () => {
    expect(mergeTeamEvents([], [ev('e1', 100000, { userId: 'u2' })], t, 'u1')).toEqual([])
  })

  it('dedupes by id on repeated merges', () => {
    const once = mergeTeamEvents([], [ev('e1', 100000)], t, 'u1')
    expect(mergeTeamEvents(once, [ev('e1', 100000)], t, 'u1')).toHaveLength(1)
  })

  it('drops own events already in memory (same collection+item+operation)', () => {
    const own = msg({ id: 'a', timestamp: 100000, collection: 'shopProducts', operation: 'update', itemId: 'i1' })
    const out = mergeTeamEvents([own], [ev('e1', 103000, { itemId: 'i1' })], t, 'u1')
    expect(out.map(m => m.id)).toEqual(['a'])
  })

  it('clears event entries on a team switch, keeping local ones', () => {
    const h = mergeTeamEvents([msg({ id: 'a', timestamp: 1000 })], [ev('e1', 100000)], t, 'u1')
    expect(dropTeamEvents(h).map(m => m.id)).toEqual(['a'])
  })

  it('caps at STATUS_RECENT_MAX', () => {
    const events = Array.from({ length: 12 }, (_, i) => ev(`e${i}`, 100000 + i * 60000))
    const out = mergeTeamEvents([], events, t, 'u1')
    expect(out).toHaveLength(STATUS_RECENT_MAX)
    expect(out[0]!.id).toBe('event-e11')
  })
})

describe('mergeTeamEvents with live sync', () => {
  const ev = (over = {}) => ({ id: 'e1', timestamp: 2000, operation: 'update', collectionName: 'bookings', userId: 'other', userName: 'Lotte Smith', itemId: 'b12', ...over })

  it('drops others without includeOthers', () => {
    expect(mergeTeamEvents([], [ev()], t, 'me')).toEqual([])
  })

  it('merges others with first name when includeOthers', () => {
    const out = mergeTeamEvents([], [ev()], t, 'me', true)
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toContain('Lotte saved')
  })

  it('dedupes by event id', () => {
    const first = mergeTeamEvents([], [ev()], t, 'me', true)
    expect(mergeTeamEvents(first, [ev()], t, 'me', true)).toHaveLength(1)
  })

  it('keeps own entries unchanged', () => {
    const own = mergeTeamEvents([], [ev({ userId: 'me', id: 'e2' })], t, 'me', true)
    expect(own[0]!.text).toContain('You saved')
  })
})
