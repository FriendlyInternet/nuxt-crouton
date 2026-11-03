import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { tracks: [] as any[], piles: [] as any[], inserted: [] as any[], blobs: [] as string[], tips: [] as any[], seeded: 0 }
const T = { tracks: { id: 'id', rekordboxId: 'rb', teamId: 't', __n: 'tracks' }, piles: { id: 'id', teamId: 't', __n: 'piles' } }

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }))
vi.mock('hub:blob', () => ({ blob: { put: async (k: string) => { state.blobs.push(k) } } }))
vi.mock('~~/server/db/schema', () => ({ crateTracks: T.tracks, cratePiles: T.piles }))
vi.mock('~~/server/utils/crate-uploads', () => ({ BLOB_PREFIX: 'blob:', UPLOAD_ID_PREFIX: 'up:' }))
vi.mock('~~/server/utils/crate-import', () => ({
  seedPiles: async () => { state.seeded++; state.piles.push({ id: 'p' }) },
  mergeLookupSource: async (_a: any, _s: string, tips: any[]) => { state.tips.push(...tips) }
}))

const db = {
  select: () => ({
    from: (t: any) => ({
      where: () => {
        const rows = t.__n === 'tracks' ? state.tracks : state.piles
        const r: any = Promise.resolve(rows.map((x: any) => ({ id: x.id, rekordboxId: x.rekordboxId })))
        r.limit = async () => rows.slice(0, 1)
        return r
      }
    })
  }),
  insert: () => ({
    values: (rows: any[]) => ({
      onConflictDoNothing: async () => {
        state.inserted.push(...rows)
        rows.forEach((r, i) => state.tracks.push({ id: `id${state.tracks.length + i}`, rekordboxId: r.rekordboxId }))
      }
    })
  })
}

let cfg: any = {}
vi.stubGlobal('useDB', () => db)
vi.stubGlobal('useRuntimeConfig', () => cfg)

const audit = { teamId: 'team1', owner: 'u', createdBy: 'u', updatedBy: 'u' }

describe('demo library seed (#3299)', () => {
  beforeEach(() => { Object.assign(state, { tracks: [], piles: [], inserted: [], blobs: [], tips: [], seeded: 0 }); cfg = {} })

  it('is off unless crateDemoSeed is set (production never seeds)', async () => {
    const { demoSeedEnabled } = await import('../server/utils/crate-demo')
    expect(demoSeedEnabled()).toBe(false)
    cfg = { crateDemoSeed: 'true' }
    expect(demoSeedEnabled()).toBe(true)
  })

  it('seeds piles, 6 tracks, 3 playable tones and 3 tips into an empty team', async () => {
    const { seedDemoLibrary } = await import('../server/utils/crate-demo')
    await seedDemoLibrary(audit)
    expect(state.seeded).toBe(1)
    expect(state.inserted).toHaveLength(6)
    expect(state.blobs).toHaveLength(3)
    expect(state.inserted.filter(r => r.audioPath).length).toBe(3)
    expect(state.tips).toHaveLength(3)
  })

  it('a second run adds nothing', async () => {
    const { seedDemoLibrary } = await import('../server/utils/crate-demo')
    await seedDemoLibrary(audit)
    await seedDemoLibrary(audit)
    expect(state.inserted).toHaveLength(6)
    expect(state.seeded).toBe(1)
  })

  it('leaves a team with owner-made piles alone, even with no tracks', async () => {
    state.piles.push({ id: 'mine' })
    const { seedDemoLibrary } = await import('../server/utils/crate-demo')
    await seedDemoLibrary(audit)
    expect(state.seeded).toBe(0)
    expect(state.inserted).toHaveLength(0)
  })
})
