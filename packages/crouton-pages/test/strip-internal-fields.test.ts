/**
 * The public collection endpoints must not leak what the admin queries join in: staff user
 * rows (with emails) and audit ids — at the top level AND inside hydrated FK rows.
 * (Red-team finding on PR #2317; #2309.)
 */
import { describe, it, expect } from 'vitest'
import { stripInternalFields } from '../server/utils/strip-internal-fields'

const user = { id: 'u1', name: 'Staff', email: 'staff@example.com', image: null }

describe('stripInternalFields', () => {
  it('drops audit ids and every joined user object at the top level', () => {
    const out = stripInternalFields({
      id: 'p1', title: 'Coffee', price: 2.5,
      owner: 'u1', createdBy: 'u1', updatedBy: 'u1', userId: 'u1',
      ownerUser: user, createdByUser: user, updatedByUser: user,
    })
    expect(out).toEqual({ id: 'p1', title: 'Coffee', price: 2.5 })
  })

  it('strips inside hydrated reference rows and arrays, which carry their own user joins', () => {
    const out = stripInternalFields({
      id: 'p1',
      categoryIdData: { id: 'c1', name: 'Drinks', owner: 'u1', ownerUser: user },
      tags: [{ id: 't1', label: 'hot', createdBy: 'u1', createdByUser: user }],
    })
    expect(out).toEqual({
      id: 'p1',
      categoryIdData: { id: 'c1', name: 'Drinks' },
      tags: [{ id: 't1', label: 'hot' }],
    })
    expect(JSON.stringify(out)).not.toContain('@example.com')
  })

  it('leaves dates, nulls and scalars alone and does not mutate the input', () => {
    const createdAt = new Date('2026-01-01')
    const input = { id: 'p1', createdAt, note: null, ownerUser: user }
    const out = stripInternalFields(input)
    expect(out.createdAt).toBe(createdAt)
    expect(out.note).toBeNull()
    expect(input.ownerUser).toBe(user)
  })
})
