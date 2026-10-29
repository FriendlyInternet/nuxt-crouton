import { describe, it, expect } from 'vitest'
import { allowedVisibilities, resolveVisibilities } from '../server/utils/page-visibility'

const none = { isAdmin: false, isMember: false, hasScopedAccess: false }
const resolve = (access: Partial<typeof none>, requested?: string) =>
  resolveVisibilities(allowedVisibilities({ ...none, ...access }), requested)

describe('page visibility resolution (#3136)', () => {
  it('anonymous cannot request restricted visibilities', () => {
    expect(resolve({}, 'admin')).toEqual([])
    expect(resolve({}, 'members')).toEqual([])
    expect(resolve({}, 'scoped')).toEqual([])
  })

  it('anonymous gets public only', () => {
    expect(resolve({})).toEqual(['public'])
    expect(resolve({}, 'public')).toEqual(['public'])
  })

  it('member cannot request admin, can request members', () => {
    expect(resolve({ isMember: true }, 'admin')).toEqual([])
    expect(resolve({ isMember: true }, 'members')).toEqual(['members'])
  })

  it('admin can request admin', () => {
    expect(resolve({ isAdmin: true, isMember: true }, 'admin')).toEqual(['admin'])
  })

  it('scoped token unlocks scoped but not members', () => {
    expect(resolve({ hasScopedAccess: true }, 'scoped')).toEqual(['scoped'])
    expect(resolve({ hasScopedAccess: true }, 'members')).toEqual([])
  })
})
