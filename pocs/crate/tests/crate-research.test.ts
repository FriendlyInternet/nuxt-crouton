// Research from the card (#2243): the question builder, the pasted-answer reader and both
// endpoints, against a real in-memory SQLite database (same setup as crate-demo.test.ts).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/db/schema'
import { mergeLookupSource } from '../server/utils/crate-import'
import { beatportId, buildResearchPrompt, cleanTitle, measuredEnergy, parseResearchAnswer } from '../server/utils/crate-research'

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

let body: unknown
let trackId = 't1'
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
vi.stubGlobal('useDB', () => db)
vi.stubGlobal('mergeLookupSource', mergeLookupSource)
vi.stubGlobal('getRouterParams', () => ({ trackId }))
vi.stubGlobal('readValidatedBody', async (_e: unknown, parse: (b: unknown) => unknown) => parse(body))
vi.stubGlobal('createError', (o: { statusCode: number, statusMessage?: string }) => Object.assign(new Error(o.statusMessage), o))

const audit = { owner: 'u1', createdBy: 'u1', updatedBy: 'u1' }
const answer = {
  genres: [{ word: 'Deep House', weight: 0.9, parent: 'House' }], moods: ['groovy'], energy: 3,
  confidence: 0.8, level: 'track', sources: [{ label: 'Bandcamp', url: 'https://x.test' }], note: 'n'
}

async function seed(comments: string | null = null) {
  await db.insert(schema.crateTracks).values([
    { ...audit, teamId: 'team1', id: 't1', rekordboxId: 'r1', name: 'Song', artist: 'Artist', location: 'a/b.mp3', tags: [], originalComments: comments },
    { ...audit, teamId: 'team2', id: 'other', rekordboxId: 'r2', name: 'Theirs', artist: 'X', location: 'a/c.mp3', tags: [] }
  ])
}
const agentEntries = async () => {
  const [row] = await db.select().from(schema.crateLookups).where(eq(schema.crateLookups.trackId, 't1'))
  return ((row?.results ?? []) as { source: string, energy?: number, styles?: unknown }[])
}

describe('facts', () => {
  it('cleanTitle', () => {
    expect(cleanTitle('4A - 128 - Song (Original Mix)', 'A').title).toBe('Song')
    expect(cleanTitle('Song (feat. Guest) [Extended Mix]', 'Artist')).toEqual({ title: 'Song', artist: 'Artist feat. Guest' })
    expect(cleanTitle('Song (Bob Remix)', 'A').title).toBe('Song (Bob Remix)')
  })
  it('beatportId / measuredEnergy', () => {
    expect(beatportId('/x/12345678_Song.mp3')).toBe('12345678')
    expect(beatportId('/x/Song.mp3')).toBeNull()
    expect(measuredEnergy('Energy 7')).toBe(7)
    expect(measuredEnergy('Energy 12')).toBeNull()
  })
})

describe('buildResearchPrompt', () => {
  it('fills in facts, piles and same-artist filing', () => {
    const piles = [{ id: 'h', name: 'House', parentId: null }, { id: 'd', name: 'Deep House', parentId: 'h' }]
    const { prompt } = buildResearchPrompt(
      { id: 't1', name: 'Song', artist: 'Artist', bpm: 124.2, location: '/x/12345678_Song.mp3' },
      piles,
      [{ id: 't2', name: 'Older', artist: 'Artist', tags: ['Deep House'] }]
    )
    expect(prompt).toContain('Title: Song')
    expect(prompt).toContain('BPM: 124')
    expect(prompt).toContain('Beatport track ID: 12345678')
    expect(prompt).toContain('House › Deep House')
    expect(prompt).toContain('Artist – Older: House › Deep House')
    expect(prompt).not.toContain('{{')
  })
})

describe('parseResearchAnswer', () => {
  const json = JSON.stringify(answer)
  it('reads plain, fenced and wrapped JSON', () => {
    for (const t of [json, `\`\`\`json\n${json}\n\`\`\``, `Here you go: ${json} Hope it helps`]) {
      expect('data' in parseResearchAnswer(t)).toBe(true)
    }
  })
  it('rejects a missing field and non-JSON', () => {
    expect('error' in parseResearchAnswer(JSON.stringify({ ...answer, genres: undefined }))).toBe(true)
    expect('error' in parseResearchAnswer('sorry, no idea')).toBe(true)
  })
})

describe('research endpoints', () => {
  beforeEach(async () => { db = await freshDb(); team = { id: 'team1' }; trackId = 't1' })
  const post = async () => ((await import('../server/api/teams/[id]/crate/tracks/[trackId]/research-answer.post')).default as (e: unknown) => Promise<unknown>)({})
  const get = async () => ((await import('../server/api/teams/[id]/crate/tracks/[trackId]/research-prompt.get')).default as (e: unknown) => Promise<{ prompt: string }>)({})

  it('saves an Agent entry, replaces it on a second paste, keeps other sources', async () => {
    await seed()
    await mergeLookupSource({ ...audit, teamId: 'team1' }, 'Audio', [{ trackId: 't1', result: { styles: [['House', 1]] } }])
    body = { text: `ok ${JSON.stringify(answer)}` }
    await post()
    await post()
    const entries = await agentEntries()
    expect(entries.filter(e => e.source === 'Agent')).toHaveLength(1)
    expect(entries.filter(e => e.source === 'Audio')).toHaveLength(1)
  })

  it('measured energy beats the answer', async () => {
    await seed('Energy 8')
    body = { answer }
    await post()
    expect((await agentEntries()).find(e => e.source === 'Agent')!.energy).toBe(4)
  })

  it('bad text is a 400', async () => {
    await seed()
    body = { text: 'nope' }
    await expect(post()).rejects.toMatchObject({ statusCode: 400 })
  })

  it('prompt for another team’s track is a 404', async () => {
    await seed()
    trackId = 'other'
    await expect(get()).rejects.toMatchObject({ statusCode: 404 })
    trackId = 't1'
    expect((await get()).prompt).toContain('Title: Song')
  })
})
