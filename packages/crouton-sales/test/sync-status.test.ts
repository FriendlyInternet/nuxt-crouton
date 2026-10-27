import { describe, it, expect, vi } from 'vitest'
import { recordLostEdits, recordSyncPull, recordSyncHeartbeat, toStatusPayload, type SyncStatus } from '../server/utils/sync-status'

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
    lastPullAt: null,
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

describe('#816 pull time and lost edits', () => {
  it('recordSyncPull stamps only the pull time for the device', async () => {
    const { db, calls } = fakeDb()
    await recordSyncPull(db, { deviceId: 'till-1', teamId: 'A' })
    expect(calls.values).toMatchObject({ id: 'till-1', teamId: 'A' })
    expect(calls.values.lastPullAt).toBeInstanceOf(Date)
    expect(Object.keys(calls.set)).toEqual(['lastPullAt', 'updatedAt'])
  })

  it('payload carries lastPullAt per till and the lost edits with both versions', () => {
    const row = (deviceId: string): SyncStatus => ({
      deviceId, teamId: 'A', lastContactAt: new Date(10), lastEventAt: null, lastBatchApplied: 0, lastPullAt: new Date(7),
    })
    const p = toStatusPayload([row('t1')], 50, [{
      id: 'c1', deviceId: 't1', entityType: 'product', entityId: 'p1', reason: 'older',
      lost: { price: 5 }, kept: { price: 6 }, createdAt: new Date(40),
    }])
    expect(p.devices[0]!.lastPullAt).toBe(7)
    expect(p.lostEdits).toEqual([{
      id: 'c1', deviceId: 't1', entityType: 'product', entityId: 'p1', reason: 'older',
      lost: { price: 5 }, kept: { price: 6 }, at: 40,
    }])
  })

  it('recordLostEdits stores what the till sent and what the cloud kept', async () => {
    let rows: any[] = []
    const db = { insert: () => ({ values: async (v: any) => { rows = v } }) }
    await recordLostEdits(db, [
      { entityType: 'product', entityId: 'p1', reason: 'older', payload: { price: 5 }, current: { price: 6 } },
    ], { deviceId: 't1', teamId: 'A' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ teamId: 'A', deviceId: 't1', entityId: 'p1', reason: 'older' })
    expect(JSON.parse(rows[0].lostJson)).toEqual({ price: 5 })
    expect(JSON.parse(rows[0].keptJson)).toEqual({ price: 6 })
  })

  it('records every conflict of a large batch, chunked under the D1 bound-param cap', async () => {
    const rows: any[] = []
    const db = {
      insert: () => ({
        values: async (v: any[]) => {
          // a multi-row insert binds ≥ 1 param per column per row; D1 rejects > 100
          if (v.length * Object.keys(v[0]).length > 100) throw new Error('too many SQL variables')
          rows.push(...v)
        },
      }),
    }
    const conflicts = Array.from({ length: 30 }, (_, i) => ({
      entityType: 'product', entityId: `p${i}`, reason: 'older', payload: { price: i }, current: { price: 0 },
    }))
    await recordLostEdits(db, conflicts, { deviceId: 't1', teamId: 'A' })
    expect(rows).toHaveLength(30)
    expect(new Set(rows.map(r => r.entityId)).size).toBe(30)
  })

  it('records nothing without conflicts or a team, and never throws', async () => {
    const insert = vi.fn()
    await recordLostEdits({ insert }, [], { teamId: 'A' })
    await recordLostEdits({ insert }, [{ entityType: 'product', entityId: 'p', reason: 'older', payload: {} }], {})
    expect(insert).not.toHaveBeenCalled()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boom = { insert: () => { throw new Error('x') } }
    await expect(recordLostEdits(boom, [{ entityType: 'product', entityId: 'p', reason: 'older', payload: {} }], { teamId: 'A' })).resolves.toBeUndefined()
    warn.mockRestore()
  })
})
