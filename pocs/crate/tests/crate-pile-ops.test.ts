import { describe, expect, it } from 'vitest'
import { PileOpError, planMove, planMoveUp, planRemove, planRename, planShift, type PileRow, type TrackRow } from '../server/utils/crate-pile-ops'

// Latin & World › Arabic › { Post-Shaabi, Raï }, plus House at the top.
const piles: PileRow[] = [
  { id: 'lw', name: 'Latin & World', parentId: null, order: 0 },
  { id: 'house', name: 'House', parentId: null, order: 1 },
  { id: 'ar', name: 'Arabic', parentId: 'lw', order: 0 },
  { id: 'ps', name: 'Post-Shaabi', parentId: 'ar', order: 0 },
  { id: 'rai', name: 'Raï', parentId: 'ar', order: 1 }
]
const tracks: TrackRow[] = [
  { id: 't1', tags: ['Latin & World', 'Arabic', 'Post-Shaabi', 'PMCP'] },
  { id: 't2', tags: ['latin & world', 'arabic', 'post-shaabi', 'Raï'] }, // also in a sibling
  { id: 't3', tags: ['House'] },
  { id: 't4', tags: ['Latin & World', 'Arabic'] } // loose in Arabic
]

describe('planRename', () => {
  it('renames the tag on every track that has it, any case, as one step', () => {
    const plan = planRename(piles, tracks, 'ps', 'Shaabi Wave')
    expect(plan.piles).toEqual([{ pileId: 'ps', after: { name: 'Shaabi Wave', parentId: 'ar', order: 0 } }])
    expect(plan.tracks).toEqual([
      { trackId: 't1', tags: ['Latin & World', 'Arabic', 'Shaabi Wave', 'PMCP'] },
      { trackId: 't2', tags: ['latin & world', 'arabic', 'Shaabi Wave', 'Raï'] }
    ])
  })
  it('refuses a name another pile already has', () => {
    expect(() => planRename(piles, tracks, 'ps', 'house')).toThrow(PileOpError)
  })
  it('refuses commas and empty names', () => {
    expect(() => planRename(piles, tracks, 'ps', 'a, b')).toThrow(PileOpError)
    expect(() => planRename(piles, tracks, 'ps', '  ')).toThrow(PileOpError)
  })
  it('allows changing only the case of its own name', () => {
    expect(planRename(piles, tracks, 'house', 'HOUSE').tracks).toEqual([{ trackId: 't3', tags: ['HOUSE'] }])
  })
})

describe('planMove', () => {
  it('moving to the top level drops ancestor tags nothing else needs', () => {
    const plan = planMove(piles, tracks, 'ps', null)
    expect(plan.piles).toEqual([{ pileId: 'ps', after: { name: 'Post-Shaabi', parentId: null, order: 2 } }])
    // t1 only had the ancestors because of Post-Shaabi; t2 still needs them for Raï; t4 isn't in it.
    expect(plan.tracks).toEqual([{ trackId: 't1', tags: ['Post-Shaabi', 'PMCP'] }])
  })
  it('moving into another pile adds that pile and its ancestors', () => {
    const plan = planMove(piles, tracks, 'ps', 'house')
    expect(plan.tracks).toEqual([
      { trackId: 't1', tags: ['Post-Shaabi', 'PMCP', 'House'] },
      { trackId: 't2', tags: ['latin & world', 'arabic', 'post-shaabi', 'Raï', 'House'] }
    ])
  })
  it('refuses moving a pile inside itself or its own sub-pile', () => {
    expect(() => planMove(piles, tracks, 'ar', 'ps')).toThrow(PileOpError)
    expect(() => planMove(piles, tracks, 'ar', 'ar')).toThrow(PileOpError)
  })
  it('moving up a level keeps the grandparent tag', () => {
    const plan = planMoveUp(piles, tracks, 'ps')
    expect(plan.piles[0]!.after).toMatchObject({ parentId: 'lw', order: 1 })
    expect(plan.tracks).toEqual([{ trackId: 't1', tags: ['Latin & World', 'Post-Shaabi', 'PMCP'] }])
  })
  it('refuses moving a top-level pile up', () => {
    expect(() => planMoveUp(piles, tracks, 'house')).toThrow(PileOpError)
  })
})

describe('planShift', () => {
  it('swaps with the neighbour and leaves tags alone', () => {
    const plan = planShift(piles, 'rai', -1)
    expect(plan.tracks).toEqual([])
    expect(plan.piles).toEqual([
      { pileId: 'rai', after: { name: 'Raï', parentId: 'ar', order: 0 } },
      { pileId: 'ps', after: { name: 'Post-Shaabi', parentId: 'ar', order: 1 } }
    ])
  })
  it('still swaps when two piles share an order number', () => {
    const tied = piles.map(p => p.id === 'rai' ? { ...p, order: 0 } : p)
    const plan = planShift(tied, 'ps', 1)
    expect(plan.piles.map(w => [w.pileId, w.after?.order])).toEqual([['ps', 1]])
  })
  it('refuses moving the first one earlier', () => {
    expect(() => planShift(piles, 'lw', -1)).toThrow(PileOpError)
  })
})

describe('planRemove', () => {
  it('removes the pile, moves its sub-piles into its place, and leaves track tags alone', () => {
    const plan = planRemove(piles, 'ar')
    expect(plan.tracks).toEqual([])
    expect(plan.piles).toEqual([
      { pileId: 'ps', after: { name: 'Post-Shaabi', parentId: 'lw', order: 0 } },
      { pileId: 'rai', after: { name: 'Raï', parentId: 'lw', order: 1 } },
      { pileId: 'ar', after: null }
    ])
  })
})
