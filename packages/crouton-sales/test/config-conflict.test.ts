import { describe, expect, it } from 'vitest'
import {
  clockOffset,
  correctTimestamp,
  resolveConflict,
} from '../server/utils/config-conflict'

const cloud = { eventLive: false, side: 'cloud' as const }

describe('resolveConflict', () => {
  it('newer edit wins, older loses', () => {
    expect(resolveConflict({ updatedAt: 100 }, { updatedAt: 200 }, cloud).decision).toBe('apply')
    expect(resolveConflict({ updatedAt: 200 }, { updatedAt: 100 }, cloud).decision).toBe('keep')
  })

  it('equal timestamps tie-break by deviceId, same winner from both sides', () => {
    const a = { updatedAt: 100, deviceId: 'a' }
    const b = { updatedAt: 100, deviceId: 'b' }
    // cloud holds a, receives b → b wins; till holds b, receives a → keeps b
    expect(resolveConflict(a, b, cloud).decision).toBe('apply')
    expect(resolveConflict(b, a, { eventLive: false, side: 'till' }).decision).toBe('keep')
    expect(resolveConflict(a, b, cloud).reason).toBe('tie-break')
  })

  it('till wins while the event is live', () => {
    const newerCloud = { updatedAt: 999 }
    const olderTill = { updatedAt: 1 }
    // cloud applying an incoming till edit
    expect(resolveConflict(newerCloud, olderTill, { eventLive: true, side: 'cloud' }).decision).toBe('apply')
    // till applying an incoming cloud edit
    expect(resolveConflict(olderTill, newerCloud, { eventLive: true, side: 'till' }).decision).toBe('keep')
  })

  it('a delete marker beats an older edit and loses to a newer one', () => {
    const marker = { updatedAt: 50, deletedAt: 300 }
    expect(resolveConflict({ updatedAt: 200 }, marker, cloud).decision).toBe('apply')
    expect(resolveConflict({ updatedAt: 400 }, marker, cloud).decision).toBe('keep')
  })

  it('picks the right winner when the till clock is 10 minutes off', () => {
    const TEN_MIN = 10 * 60_000
    const serverNow = 1_000_000_000
    // till clock runs 10 min fast; round trip 200ms
    const sentAt = serverNow + TEN_MIN - 100
    const receivedAt = serverNow + TEN_MIN + 100
    const offset = clockOffset(serverNow, sentAt, receivedAt)
    expect(offset).toBe(-TEN_MIN)

    // cloud edit at server time T; till edit really happened 1s later but stamped 10 min fast
    const cloudEdit = { updatedAt: serverNow - 5000 }
    const tillEditRaw = serverNow - 4000 + TEN_MIN
    const tillEdit = { updatedAt: correctTimestamp(tillEditRaw, offset) }

    expect(resolveConflict(cloudEdit, tillEdit, cloud).decision).toBe('apply')
    // uncorrected, a till edit made 1s EARLIER would wrongly win
    const earlierTillRaw = serverNow - 6000 + TEN_MIN
    expect(resolveConflict(cloudEdit, { updatedAt: earlierTillRaw }, cloud).decision).toBe('apply')
    expect(resolveConflict(cloudEdit, { updatedAt: correctTimestamp(earlierTillRaw, offset) }, cloud).decision).toBe('keep')
  })
})
