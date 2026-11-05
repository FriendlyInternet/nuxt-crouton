import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { applyOutboxEvents } from '../server/utils/sync-ingest'
import { authenticateSync } from '../server/utils/cloud-sync-auth'
import { syncAuthHeaders } from '../server/utils/cloud-sync-pusher'

/**
 * #2725 — each till syncs as itself; the cloud only accepts rows for that
 * till's team.
 */
const tbl = () => sqliteTable('t', { id: text('id').primaryKey(), teamId: text('team_id') })

function fakeDb(existing: Array<{ teamId: string }> = []) {
  const inserted: any[] = []
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => existing }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    insert: () => ({ values: async (v: any) => { inserted.push(v) } }),
  }
  return { db, inserted }
}

describe('applyOutboxEvents team scoping', () => {
  const tables = { order: tbl(), orderitem: tbl(), printstatus: tbl() } as any

  it('a till on team A cannot write team B rows (permanent skip)', async () => {
    const { db, inserted } = fakeDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await applyOutboxEvents(db, [
      { id: 'e1', entityType: 'order', entityId: 'o1', payload: { teamId: 'B' } },
    ], tables, 'A')
    expect(res.applied).toEqual([])
    expect(res.skipped).toEqual([{ id: 'e1', reason: 'team mismatch', permanent: true }])
    expect(inserted).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("a till on team A cannot update team B's existing row by id", async () => {
    const { db, inserted } = fakeDb([{ teamId: 'B' }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await applyOutboxEvents(db, [
      { id: 'e1', entityType: 'order', entityId: 'o1', payload: {} },
    ], tables, 'A')
    expect(res.applied).toEqual([])
    expect(res.skipped).toEqual([{ id: 'e1', reason: 'team mismatch', permanent: true }])
    expect(inserted).toEqual([])
    warn.mockRestore()
  })

  it('applies own-team rows and forces teamId on rows without one', async () => {
    const { db, inserted } = fakeDb()
    const res = await applyOutboxEvents(db, [
      { id: 'e1', entityType: 'order', entityId: 'o1', payload: { teamId: 'A' } },
      { id: 'e2', entityType: 'order', entityId: 'o2', payload: {} },
    ], tables, 'A')
    expect(res.applied).toEqual(['e1', 'e2'])
    expect(inserted.map(r => r.teamId)).toEqual(['A', 'A'])
  })

  it('without a scope (shared-key) leaves rows untouched', async () => {
    const { db, inserted } = fakeDb()
    await applyOutboxEvents(db, [
      { id: 'e1', entityType: 'order', entityId: 'o1', payload: { teamId: 'B' } },
    ], tables)
    expect(inserted[0].teamId).toBe('B')
  })
})

describe('authenticateSync', () => {
  let headers: Record<string, string>
  beforeEach(() => {
    headers = {}
    vi.stubGlobal('getHeader', (_e: any, name: string) => headers[name])
    vi.stubGlobal('useRuntimeConfig', () => ({ croutonSales: { cloudSyncSecret: 'shared' } }))
    vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText), o))
  })
  const ev = {} as any

  it('resolves a paired device to its grant team', async () => {
    headers = { 'x-device-id': 'device:1', 'x-device-secret': 's' }
    const verify = vi.fn(async () => ({ ok: true as const, organizationId: 'A' }))
    expect(await authenticateSync(ev, verify)).toEqual({ kind: 'device', deviceId: 'device:1', teamId: 'A' })
  })

  it('rejects bad device credentials and never falls back to the shared key', async () => {
    headers = { 'x-device-id': 'device:1', 'x-device-secret': 's', 'x-sync-key': 'shared' }
    await expect(authenticateSync(ev, async () => ({ ok: false }))).rejects.toMatchObject({ status: 401 })
  })

  it('keeps x-sync-key working when no device headers are sent', async () => {
    headers = { 'x-sync-key': 'shared' }
    expect(await authenticateSync(ev)).toEqual({ kind: 'shared-key' })
    headers = { 'x-sync-key': 'wrong' }
    await expect(authenticateSync(ev)).rejects.toMatchObject({ status: 401 })
  })
})

describe('syncAuthHeaders', () => {
  it('prefers the device identity over the shared secret', () => {
    expect(syncAuthHeaders({ deviceId: 'd', deviceSecret: 's', secret: 'k' }))
      .toEqual({ 'x-device-id': 'd', 'x-device-secret': 's' })
  })
  it('falls back to the shared secret without an identity', () => {
    vi.stubEnv('CROUTON_SALES_DEVICE_ID', '')
    vi.stubEnv('FANFARE_DEVICE_ID', '')
    expect(syncAuthHeaders({ secret: 'k' })).toEqual({ 'x-sync-key': 'k' })
    vi.unstubAllEnvs()
  })
})
