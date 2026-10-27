import { describe, it, expect, vi } from 'vitest'
import { recordSyncHeartbeat, toStatusPayload, type SyncStatus } from '../server/utils/sync-status'

/** #2725 — one heartbeat row per paired till; the status payload lists them all. */
function fakeDb() {
  const calls: { values?: any, set?: any } = {}
  const db = {
    insert: () => ({
      values: (v: any) => {
        calls.values = v
        return { onConflictDoUpdate: async (c: any) => { calls.set = c.set } }
      },
    }),
  }
  return { db, calls }
}

describe('recordSyncHeartbeat', () => {
  it('keys the row by the paired device and stamps its team', async () => {
    const { db, calls } = fakeDb()
    await recordSyncHeartbeat(db, 3, { deviceId: 'till-1', teamId: 'A' })
    expect(calls.values).toMatchObject({ id: 'till-1', teamId: 'A', lastBatchApplied: 3 })
    expect(calls.set.lastBatchApplied).toBe(3)
    expect(calls.set.lastEventAt).toBeInstanceOf(Date)
  })

  it('falls back to the shared "live" row with no team', async () => {
    const { db, calls } = fakeDb()
    await recordSyncHeartbeat(db, 0)
    expect(calls.values).toMatchObject({ id: 'live', teamId: null, lastEventAt: null, lastBatchApplied: 0 })
  })

  it('an idle ping advances contact but leaves the data fields alone', async () => {
    const { db, calls } = fakeDb()
    await recordSyncHeartbeat(db, 0, { deviceId: 'till-1', teamId: 'A' })
    expect(calls.set).not.toHaveProperty('lastEventAt')
    expect(calls.set).not.toHaveProperty('lastBatchApplied')
    expect(calls.set.lastContactAt).toBeInstanceOf(Date)
  })

  it('never throws when the write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = { insert: () => { throw new Error('boom') } }
    await expect(recordSyncHeartbeat(db, 1)).resolves.toBeUndefined()
    warn.mockRestore()
  })
})

describe('toStatusPayload', () => {
  const at = (ms: number) => new Date(ms)
  const row = (deviceId: string, contact: number | null, applied = 0): SyncStatus => ({
    deviceId,
    teamId: 'A',
    lastContactAt: contact === null ? null : at(contact),
    lastEventAt: null,
    lastBatchApplied: applied,
  })

  it('headlines the freshest till and lists every till', () => {
    const p = toStatusPayload([row('t1', 100, 2), row('t2', 500, 7)], 999)
    expect(p.lastContactAt).toBe(500)
    expect(p.lastBatchApplied).toBe(7)
    expect(p.devices.map(d => d.deviceId)).toEqual(['t1', 't2'])
    expect(p.serverNow).toBe(999)
  })

  it('reports nulls when no till has ever synced', () => {
    const p = toStatusPayload([], 1)
    expect(p).toMatchObject({ lastContactAt: null, lastEventAt: null, lastBatchApplied: 0, devices: [] })
  })
})
