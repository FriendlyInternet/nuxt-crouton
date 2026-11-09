import { describe, expect, it } from 'vitest'
import { groupRecentChanges, type ChangeRow } from '../server/utils/crate-recent'

const row = (groupId: string, t: number, extra: Partial<ChangeRow> = {}): ChangeRow =>
  ({ groupId, trackId: 't-' + groupId, pileId: null, summary: `s ${groupId}`, undoOf: null, createdAt: new Date(t), ...extra })

describe('groupRecentChanges', () => {
  it('folds a multi-track action into one entry, newest first', () => {
    const out = groupRecentChanges([row('a', 1000), row('b', 3000), row('b', 3000, { trackId: 't2' }), row('b', 3000, { trackId: 't3' })])
    expect(out.map(o => o.groupId)).toEqual(['b', 'a'])
  })
  it('marks an action undone once an undo points at it', () => {
    const out = groupRecentChanges([row('a', 1000), row('u', 2000, { undoOf: 'a' })])
    expect(out.find(o => o.groupId === 'a')?.undone).toBe(true)
    expect(out.find(o => o.groupId === 'u')).toMatchObject({ isUndo: true, undone: false })
  })
  it('a pile-only action has no track to show', () => {
    expect(groupRecentChanges([row('p', 1, { trackId: null, pileId: 'x' })])[0]?.trackId).toBeNull()
  })
  it('limits the list', () => {
    expect(groupRecentChanges(Array.from({ length: 5 }, (_, i) => row('g' + i, i)), 2)).toHaveLength(2)
  })
})
