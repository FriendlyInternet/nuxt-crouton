/**
 * The endpoint and the query function emit two halves of one contract — the params read from the
 * URL and the `opts` type they're passed as. These pin that they come from one source, and that
 * the user refs are IN (the exclusion cost you "filter by assignee/owner", which is basic).
 */
import { describe, it, expect } from 'vitest'
import { collectFilterFields } from '../../../lib/utils/filter-fields'

const fields = (...names: string[]) => names.map(n => ({ name: n, type: 'string', refTarget: 'x' }))

describe('collectFilterFields', () => {
  it('includes declared reference fields', () => {
    const data = { fields: [...fields('eventId', 'categoryId'), { name: 'title', type: 'string' }] }
    expect(collectFilterFields(data)).toEqual(
      expect.arrayContaining(['eventId', 'categoryId']),
    )
  })

  it('leaves out non-reference fields', () => {
    const data = { fields: [{ name: 'title', type: 'string' }] }
    expect(collectFilterFields(data)).not.toContain('title')
  })

  it('includes the auto user refs — filtering by owner/createdBy is ordinary, not noise', () => {
    // These were excluded as "not real FK columns". They are real columns, and "everything I own"
    // / "what did I change" are things a list should be able to answer.
    expect(collectFilterFields({ fields: [] })).toEqual(['owner', 'createdBy', 'updatedBy'])
  })

  it('includes a field the author declared as a person ref', () => {
    // The old rule stripped anything user-shaped, so declaring `assigneeId` silently cost you the
    // ability to filter by it — the #1825 chores case.
    const data = { fields: [{ name: 'assigneeId', type: 'string', refTarget: 'users', refScope: 'external' }] }
    expect(collectFilterFields(data)).toContain('assigneeId')
  })

  it('drops the audit pair when metadata is off, keeping owner', () => {
    // Mirrors detectReferenceFields: owner is unconditional, createdBy/updatedBy ride useMetadata.
    const out = collectFilterFields({ fields: [] }, { flags: { useMetadata: false } })
    expect(out).toEqual(['owner'])
  })

  it('tolerates a collection with no fields array', () => {
    expect(() => collectFilterFields({})).not.toThrow()
  })
})
