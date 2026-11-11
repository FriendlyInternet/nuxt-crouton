import { describe, it, expect, vi } from 'vitest'
import { authorizeRoomRequest, parseRoomKey } from '../server/utils/collabToken'

vi.mock('yjs', () => ({ Doc: class { destroy = vi.fn() } }))

const a = { userId: 'u1', teamId: 'A', room: 'A:page:1' }

describe('authorizeRoomRequest', () => {
  it('refuses a request with no claims (no token → 401 on /ws, /state, /users)', () => {
    expect(authorizeRoomRequest(null, 'A:page:1')).toBeNull()
  })
  it('refuses team A token on team B room', () => {
    expect(authorizeRoomRequest(a, 'B:page:1')).toBeNull()
  })
  it('refuses team A token on another room of team A', () => {
    expect(authorizeRoomRequest(a, 'A:page:2')).toBeNull()
  })
  it('refuses a team B token naming an A room', () => {
    expect(authorizeRoomRequest({ userId: 'u2', teamId: 'B', room: 'A:page:1' }, 'A:page:1')).toBeNull()
  })
  it('returns the userId on an exact match', () => {
    expect(authorizeRoomRequest(a, 'A:page:1')).toBe('u1')
  })
})

describe('parseRoomKey', () => {
  it('splits team, type and id (id may contain colons)', () => {
    expect(parseRoomKey('A:page:x:y')).toEqual({ teamId: 'A', roomType: 'page', roomId: 'x:y' })
    expect(parseRoomKey('bad')).toBeNull()
  })
})

describe('same-origin store', () => {
  it('keeps team A and team B rooms distinct', async () => {
    const { getOrCreateRoom } = await import('../server/utils/collabRoomStore')
    expect(getOrCreateRoom('page', 'A:1')).not.toBe(getOrCreateRoom('page', 'B:1'))
  })
})
