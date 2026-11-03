// Demo library seed (#3299), exercised through the real GET library handler against a real
// SQLite database: real schema, real migrations, real seedPiles / mergeLookupSource.
// Only the things that are not the database are stubbed: the team/auth lookup and blob storage.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/db/schema'
import { seedDemoLibrary, demoSeedEnabled } from '../server/utils/crate-demo'
import { buildModel, scorePiles, wordsOf } from '../server/utils/crate-hints'

vi.mock('hub:blob', () => ({ blob: { put: async () => {} } }))
let team = { id: 'team1' }
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team, user: { id: 'u1' } })
}))

let db: ReturnType<typeof drizzle>
const migrationsDir = join(__dirname, '../server/db/migrations/sqlite')

async function freshDb() {
  const client = createClient({ url: ':memory:' })
  for (const f of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(join(migrationsDir, f), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) await client.execute(stmt)
    }
  }
  return drizzle(client, { schema })
}

// The handler relies on Nitro auto-imports; provide the real implementations.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
vi.stubGlobal('useDB', () => db)
vi.stubGlobal('useRuntimeConfig', () => ({ crateDemoSeed: 'true' }))
vi.stubGlobal('demoSeedEnabled', demoSeedEnabled)
vi.stubGlobal('seedDemoLibrary', seedDemoLibrary)

async function getLibrary() {
  const handler = (await import('../server/api/teams/[id]/crate/library.get')).default as (e: unknown) => Promise<{
    piles: { id: string, name: string, parentId: string | null }[]
    tracks: { id: string, name: string, genre: string | null, tags: string[] }[]
  }>
  return handler({})
}

const audit = { owner: 'u1', createdBy: 'u1', updatedBy: 'u1' }

describe('library.get demo seed (#3299)', () => {
  beforeEach(async () => { db = await freshDb(); team = { id: 'team1' } })

  it('seeds ~6 inbox tracks and the piles into an empty team', async () => {
    const lib = await getLibrary()
    expect(lib.tracks).toHaveLength(6)
    expect(lib.piles.map(p => p.name)).toEqual(expect.arrayContaining(['House', 'Deep House', 'Techno', 'Disco & Funk', 'Hiphop']))
    const deep = lib.piles.find(p => p.name === 'Deep House')!
    expect(deep.parentId).toBe(lib.piles.find(p => p.name === 'House')!.id)
  })

  it('a second call adds nothing', async () => {
    const first = await getLibrary()
    const second = await getLibrary()
    expect(second.tracks).toHaveLength(first.tracks.length)
    expect(second.piles).toHaveLength(first.piles.length)
    expect(await db.select().from(schema.crateLookups)).toHaveLength(3)
  })

  it('leaves a team that has piles but no tracks alone', async () => {
    await db.insert(schema.cratePiles).values({
      ...audit, teamId: 'team1', id: 'mine', name: 'Mine', parentId: null, path: '/mine/', depth: 0, order: 0
    })
    const lib = await getLibrary()
    expect(lib.tracks).toHaveLength(0)
    expect(lib.piles.map(p => p.name)).toEqual(['Mine'])
  })

  it('demo tips light up "Disco & Funk" for the Disco/Funk tracks', async () => {
    const lib = await getLibrary()
    const rows = await db.select().from(schema.crateLookups).where(eq(schema.crateLookups.teamId, 'team1'))
    const model = buildModel(lib.piles, [])
    const disco = lib.piles.find(p => p.name === 'Disco & Funk')!
    const resultsFor = (name: string) => {
      const id = lib.tracks.find(t => t.name === name)!.id
      return rows.find(r => r.trackId === id)!.results as Parameters<typeof wordsOf>[0]
    }
    for (const name of ['Sunday Groove']) {
      const top = scorePiles(model, wordsOf(resultsFor(name)))[0]
      expect(top?.pileId).toBe(disco.id)
    }
  })
})
