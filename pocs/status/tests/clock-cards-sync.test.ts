import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStorage } from 'unstorage'
import memory from 'unstorage/drivers/memory'
import { onTick, type TickSync } from '../server/utils/clock-tick'
import type { CardsSyncDeps, CardsSyncRecord } from '../server/utils/cards-sync-clock'

// T3 (#4234): the clock runs the inbox card sync in the :00 and :30 slots, apart from the job
// dispatches, and records each outcome in KV for the Clock tab. Drives the REAL onTick and the REAL
// clockCardsSync; the sync's GitHub read (`run`) and the owner/team lookup are stubbed — the real
// runCardsSync is covered in cards-sync-run.test.ts, and the D1 lookup has no D1 in vitest.

vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getAllInboxCards: vi.fn(async () => []), createInboxCard: vi.fn(), updateInboxCard: vi.fn()
}))

let kv: ReturnType<typeof createStorage>
const OK: CardsSyncRecord = { at: '2026-11-18T10:00:01Z', ok: true, counts: { created: 0, updated: 0, stale: 0, answered: 0, stuck: { quiet: 0, draft: 0, epicSync: 0 } }, readErrors: null }
const tickSync = (run: TickSync['run']): TickSync => ({ run, store: () => kv })
const at = (iso: string) => Date.parse(iso)

async function pkcs8Pem(): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
  let bin = ''
  for (const b of der) bin += String.fromCharCode(b)
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin).match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`
}

async function clockCardsSync() {
  vi.stubGlobal('defineCachedFunction', (fn: unknown) => fn)
  return (await import('../server/utils/cards-sync-clock')).clockCardsSync
}

beforeEach(() => {
  kv = createStorage({ driver: memory() })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('onTick runs the inbox card sync', () => {
  // covers: T3
  it('at 10:00 and 10:30 it runs once each, with no job due, and writes clock:cards-sync:last', async () => {
    const run = vi.fn(async () => OK)
    const f = vi.fn()
    for (const t of ['2026-11-18T10:00:00Z', '2026-11-18T10:30:00Z']) {
      expect(await onTick(at(t), { CLOCK_ENABLED: '1' }, f as any, tickSync(run))).toEqual([])
    }
    expect(run).toHaveBeenCalledTimes(2)
    expect(f).not.toHaveBeenCalled() // nothing due: no token mint, no dispatch
    expect(await kv.getItem('clock:cards-sync:last')).toEqual(OK)
  })

  // covers: T3
  it('not at :10, :20, :40 or :50, and never with CLOCK_ENABLED off', async () => {
    const run = vi.fn(async () => OK)
    for (const m of ['10', '20', '40', '50']) await onTick(at(`2026-11-18T11:${m}:00Z`), { CLOCK_ENABLED: '1' }, vi.fn() as any, tickSync(run))
    for (const env of [{}, { CLOCK_ENABLED: '0' }]) await onTick(at('2026-11-18T11:00:00Z'), env, vi.fn() as any, tickSync(run))
    expect(run).not.toHaveBeenCalled()
    expect(await kv.getItem('clock:cards-sync:last')).toBeNull()
  })

  // covers: T3
  it('a failing App-token mint (401) still runs the sync', async () => {
    const run = vi.fn(async () => OK)
    const env = { CLOCK_ENABLED: '1', HARNESS_APP_ID: '1', HARNESS_APP_PRIVATE_KEY: await pkcs8Pem(), HARNESS_APP_INSTALLATION_ID: '42' }
    const f = vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) }))
    // 05:00: epic-digest + label-ready-epics are due, so the tick tries to mint.
    expect(await onTick(at('2026-11-18T05:00:00Z'), env, f as any, tickSync(run))).toEqual([])
    expect(f.mock.calls.some(c => String(c[0]).includes('/access_tokens'))).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(await kv.getItem('clock:cards-sync:last')).toEqual(OK)
  })

  // covers: T3
  it('a throwing sync → a record { ok: false, error }, no throw, and the slot\'s dispatches still go out', async () => {
    const env = { CLOCK_ENABLED: '1', HARNESS_APP_ID: '1', HARNESS_APP_PRIVATE_KEY: await pkcs8Pem(), HARNESS_APP_INSTALLATION_ID: '42' }
    const f = vi.fn(async (url: string) => url.includes('/access_tokens')
      ? { ok: true, status: 201, json: async () => ({ token: 'tok' }) }
      : { ok: true, status: 204 })
    const run = vi.fn(async () => { throw new Error('D1 down') })
    const out = await onTick(at('2026-11-18T05:00:00Z'), env, f as any, tickSync(run))
    expect(out).toEqual([{ workflow: 'epic-digest.yml', status: 204 }, { workflow: 'label-ready-epics.yml', status: 204 }])
    expect(await kv.getItem('clock:cards-sync:last')).toMatchObject({ ok: false, error: 'D1 down' })
  })

  // covers: T3
  it('owner or team not found → no GitHub read, the error recorded, the dispatches still made', async () => {
    const env = { CLOCK_ENABLED: '1', GITHUB_TOKEN: 'owner-token', NUXT_STATUS_OWNER_EMAIL: 'o@x.test', HARNESS_APP_ID: '1', HARNESS_APP_PRIVATE_KEY: await pkcs8Pem(), HARNESS_APP_INSTALLATION_ID: '42' }
    const f = vi.fn(async (url: string) => url.includes('/access_tokens')
      ? { ok: true, status: 201, json: async () => ({ token: 'tok' }) }
      : { ok: true, status: 204 })
    const clock = await clockCardsSync()
    const deps: CardsSyncDeps = { findOwnerTeam: async () => null, store: () => kv, run: vi.fn() as any }
    const out = await onTick(at('2026-11-18T05:00:00Z'), env, f as any, tickSync(e => clock(e, deps)))
    expect(out.map(r => r.status)).toEqual([204, 204])
    expect(deps.run).not.toHaveBeenCalled()
    expect(await kv.getItem('clock:cards-sync:last')).toMatchObject({ ok: false, error: 'owner or team not found (NUXT_STATUS_OWNER_EMAIL / test1)' })
  })
})

describe('clockCardsSync', () => {
  const owner = async () => ({ teamId: 'team1', userId: 'u1' })
  const out = { created: 2, updated: 1, stale: 0, answered: 0, stuck: { quiet: 1, draft: 0, epicSync: 0 } }

  // covers: T3
  it('no GITHUB_TOKEN → ok: false, nothing run', async () => {
    const run = vi.fn()
    const rec = await (await clockCardsSync())({ NUXT_STATUS_OWNER_EMAIL: 'o@x.test' }, { findOwnerTeam: owner, store: () => kv, run: run as any })
    expect(rec).toMatchObject({ ok: false, error: 'GITHUB_TOKEN is not configured' })
    expect(run).not.toHaveBeenCalled()
  })

  // covers: T3
  it('the team synced < 60 s ago (the endpoint\'s throttle key) → ok + throttled, nothing run', async () => {
    await kv.setItem('cards-sync:last:team1', Date.now() - 30_000)
    const run = vi.fn()
    const rec = await (await clockCardsSync())({ GITHUB_TOKEN: 'tk', NUXT_STATUS_OWNER_EMAIL: 'o@x.test' }, { findOwnerTeam: owner, store: () => kv, run: run as any })
    expect(rec).toMatchObject({ ok: true, throttled: true })
    expect(run).not.toHaveBeenCalled()
  })

  // covers: T3
  it('success → the counts, and the run\'s read errors as readErrors (still ok); stamps the throttle key', async () => {
    const find = vi.fn(owner)
    const run = vi.fn(async () => ({ ...out, error: 'GitHub 500' }))
    const rec = await (await clockCardsSync())({ GITHUB_TOKEN: 'tk', NUXT_STATUS_OWNER_EMAIL: 'o@x.test' }, { findOwnerTeam: find, store: () => kv, run })
    expect(find).toHaveBeenCalledWith('o@x.test')
    expect(run).toHaveBeenCalledWith({ token: 'tk', teamId: 'team1', userId: 'u1' })
    expect(rec).toMatchObject({ ok: true, counts: out, readErrors: 'GitHub 500' })
    expect(Number(await kv.getItem('cards-sync:last:team1'))).toBeGreaterThan(Date.now() - 5_000)
  })

  // covers: T3
  it('a throwing run → ok: false with its message, no throw', async () => {
    const rec = await (await clockCardsSync())({ GITHUB_TOKEN: 'tk', NUXT_STATUS_OWNER_EMAIL: 'o@x.test' }, { findOwnerTeam: owner, store: () => kv, run: async () => { throw new Error('boom') } })
    expect(rec).toMatchObject({ ok: false, error: 'boom' })
  })
})
