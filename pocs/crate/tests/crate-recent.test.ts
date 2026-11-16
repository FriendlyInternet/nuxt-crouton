import { describe, expect, it } from 'vitest'
import { groupRecentChanges, readRecentChanges, type ChangeRow } from '../server/utils/crate-recent'

const row = (groupId: string, t: number, extra: Partial<ChangeRow> = {}): ChangeRow =>
  ({ groupId, trackId: 't-' + groupId, pileId: null, summary: `s ${groupId}`, undoOf: null, createdAt: new Date(t), ...extra })

describe('groupRecentChanges', () => {
  it('folds a multi-track action into one entry, newest first', () => {
    const out = groupRecentChanges([row('a', 1000), row('b', 3000), row('b', 3000, { trackId: 't2' }), row('b', 3000, { trackId: 't3' })])
    expect(out.map(o => o.groupId)).toEqual(['b', 'a'])
  })
  it('marks an action undone once an undo points at it', () => {
    const out = groupRecentChanges([row('a', 1000), row('u', 2000, { undoOf: 'a' })])
    expect(out.find(o => o.groupId === 'a')?.undone).toBe(true)
    expect(out.find(o => o.groupId === 'u')).toMatchObject({ isUndo: true, undone: false })
  })
  it('a pile-only action has no track to show', () => {
    expect(groupRecentChanges([row('p', 1, { trackId: null, pileId: 'x' })])[0]?.trackId).toBeNull()
  })
  it('limits the list', () => {
    expect(groupRecentChanges(Array.from({ length: 5 }, (_, i) => row('g' + i, i)), 2)).toHaveLength(2)
  })
})

// The production read (what GET /crate/changes returns), against a real in-memory SQLite.
describe('readRecentChanges', () => {
  async function setup() {
    const { createClient } = await import('@libsql/client')
    const { drizzle } = await import('drizzle-orm/libsql')
    const client = createClient({ url: ':memory:' })
    await client.execute(`create table crate_changes (id text primary key, teamId text not null, owner text not null, groupId text not null, trackId text, pileId text, before text, after text, summary text, undoOf text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null)`)
    let n = 0
    const add = (teamId: string, groupId: string, sec: number, trackId: string | null = 't-' + groupId, undoOf: string | null = null) =>
      client.execute({ sql: `insert into crate_changes (id,teamId,owner,groupId,trackId,summary,undoOf,createdAt,updatedAt,createdBy,updatedBy) values (?,?,?,?,?,?,?,?,?,?,?)`, args: [`r${n++}`, teamId, 'o', groupId, trackId, `s ${groupId}`, undoOf, sec, sec, 'u', 'u'] })
    return { db: drizzle(client), add }
  }
  it('is newest first, one entry per action, only for this team', async () => {
    const { db, add } = await setup()
    await add('A', 'old', 100); await add('A', 'new', 200); await add('A', 'new', 200, 't2'); await add('B', 'other', 300)
    const out = await readRecentChanges(db, 'A')
    expect(out.map(o => o.groupId)).toEqual(['new', 'old'])
    expect(out[0]!.trackId).toBe('t-new')
  })
  it('orders two actions in the same second by insertion (latest first)', async () => {
    const { db, add } = await setup()
    await add('A', 'first', 500); await add('A', 'second', 500); await add('A', 'third', 500)
    expect((await readRecentChanges(db, 'A')).map(o => o.groupId)).toEqual(['third', 'second', 'first'])
  })
  it('a huge rename does not hide earlier actions', async () => {
    const { db, add } = await setup()
    await add('A', 'before', 100)
    for (let i = 0; i < 350; i++) await add('A', 'big', 200, 't' + i)
    expect((await readRecentChanges(db, 'A')).map(o => o.groupId)).toEqual(['big', 'before'])
  })
  it('marks an action undone when its undo is listed', async () => {
    const { db, add } = await setup()
    await add('A', 'a', 100); await add('A', 'u', 200, 't-a', 'a')
    expect((await readRecentChanges(db, 'A')).find(o => o.groupId === 'a')?.undone).toBe(true)
  })
})
