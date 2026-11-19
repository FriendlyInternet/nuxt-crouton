/**
 * #3982 T10 — the MCP pages tools' page source: team-scoped reads (Rule A) and
 * no write path (Rule B).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as any[],
  wheres: [] as any[],
  writes: vi.fn()
}))

vi.mock('drizzle-orm', () => ({
  eq: (a: any, b: any) => ({ op: 'eq', a, b }),
  and: (...a: any[]) => ({ op: 'and', a })
}))
vi.mock('../collections/pages/server/database/schema', () => ({
  pagesPages: {
    id: 'id', teamId: 'teamId', pageType: 'pageType', status: 'status', parentId: 'parentId',
    title: 'title', slug: 'slug', translations: 'translations'
  }
}))

import { getStoredPageContentForMcp, listTeamPagesForMcp } from '../server/utils/page-live-source'

/** Fake drizzle that filters the rows by the where clause, so a wrong scope shows up as a leak. */
function matches(row: any, cond: any): boolean {
  if (!cond) return true
  if (cond.op === 'and') return cond.a.every((c: any) => matches(row, c))
  if (cond.op === 'eq') return row[cond.a] === cond.b
  return false
}

function installDb() {
  ;(globalThis as any).useDB = () => ({
    select: () => {
      let cond: any
      let limit = Infinity
      const chain: any = {
        from: () => chain,
        where: (c: any) => { cond = c; h.wheres.push(c); return chain },
        limit: (n: number) => { limit = n; return chain },
        then: (res: any, rej: any) => Promise.resolve(h.rows.filter(r => matches(r, cond)).slice(0, limit)).then(res, rej)
      }
      return chain
    },
    update: () => { h.writes('update'); throw new Error('no writes') },
    insert: () => { h.writes('insert'); throw new Error('no writes') },
    delete: () => { h.writes('delete'); throw new Error('no writes') }
  })
}

const contains = (cond: any, wanted: any): boolean =>
  JSON.stringify(cond) === JSON.stringify(wanted)
  || (cond?.op === 'and' && cond.a.some((c: any) => contains(c, wanted)))

// covers: T10
describe('page-live-source (#3982)', () => {
  beforeEach(() => {
    h.wheres = []
    h.writes.mockClear()
    h.rows = [
      { id: 'pA', teamId: 'team_A', pageType: 'pages:regular', status: 'draft', parentId: null, title: 'Home', slug: 'home',
        translations: { fr: { title: 'Accueil', slug: 'accueil', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }) } } },
      { id: 'pB', teamId: 'team_B', pageType: 'pages:regular', status: 'draft', parentId: null, title: 'Secret', slug: 'secret',
        translations: { fr: { title: 'Secret', slug: 'secret', content: '{"type":"doc","content":[]}' } } }
    ]
    installDb()
  })

  it('getStoredPageContentForMcp: another team\'s page reads as null, scoped by teamId', async () => {
    expect(await getStoredPageContentForMcp('team_A', 'pB', 'fr')).toBeNull()
    expect(contains(h.wheres[0], { op: 'eq', a: 'teamId', b: 'team_A' })).toBe(true)
    expect(contains(h.wheres[0], { op: 'eq', a: 'id', b: 'pB' })).toBe(true)
  })

  it('getStoredPageContentForMcp: own page returns the parsed locale content', async () => {
    expect(await getStoredPageContentForMcp('team_A', 'pA', 'fr')).toEqual({
      id: 'pA', locale: 'fr', content: { type: 'doc', content: [{ type: 'paragraph' }] }
    })
    expect(await getStoredPageContentForMcp('team_A', 'pA', 'nl')).toEqual({ id: 'pA', locale: 'nl', content: null })
  })

  it('listTeamPagesForMcp filters by teamId and lists title/slug per locale', async () => {
    const pages = await listTeamPagesForMcp('team_A')
    expect(h.wheres[0]).toEqual({ op: 'eq', a: 'teamId', b: 'team_A' })
    expect(pages).toEqual([
      { id: 'pA', pageType: 'pages:regular', status: 'draft', parentId: null, translations: { fr: { title: 'Accueil', slug: 'accueil' } } }
    ])
  })

  it('never writes (no update / insert / delete)', async () => {
    await listTeamPagesForMcp('team_A')
    await getStoredPageContentForMcp('team_A', 'pA', 'fr')
    await getStoredPageContentForMcp('team_A', 'pB', 'fr')
    expect(h.writes).not.toHaveBeenCalled()
  })
})
