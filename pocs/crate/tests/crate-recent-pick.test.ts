import { describe, expect, it, vi } from 'vitest'
import { pickRecentTrack } from '../app/utils/crate-recent-pick'

const tracks = [{ id: 'a' }, { id: 'b' }]

describe('pickRecentTrack', () => {
  it('puts the picked track on the deck', () => {
    const put = vi.fn(), gone = vi.fn()
    pickRecentTrack('b', tracks, put, gone)
    expect(put).toHaveBeenCalledWith(tracks[1])
    expect(gone).not.toHaveBeenCalled()
  })
  it('says the track is gone when it no longer exists', () => {
    const put = vi.fn(), gone = vi.fn()
    pickRecentTrack('zzz', tracks, put, gone)
    expect(put).not.toHaveBeenCalled()
    expect(gone).toHaveBeenCalled()
  })
})
