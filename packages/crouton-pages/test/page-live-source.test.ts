/**
 * #3982 T10 — the MCP pages tools' page source: team-scoped reads (Rule A) and
 * no write path (Rule B).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as any[],
  wheres: [] as any[],
  writes: vi.fn(),
  created: [] as any[]
}))

vi.mock('drizzle-orm', () => ({
  eq: (a: any, b: any) => ({ op: 'eq', a, b }),
  and: (...a: any[]) => ({ op: 'and', a })
}))
vi.mock('../collections/pages/server/database/schema', () => ({
  pagesPages: {
    id: 'id', teamId: 'teamId', pageType: 'pageType', status: 'status', parentId: 'parentId',
    title: 'title', slug: 'slug', translations: 'translations', path: 'path', depth: 'depth'
  }
}))
// The collection's own insert (#4193): captured, so a test sees exactly what is written
vi.mock('../collections/pages/server/database/queries', () => ({
  createPagesPage: async (data: any) => { h.created.push(data); h.rows.push(data); return data }
}))

import { createPageForMcp, getStoredPageContentForMcp, listTeamPagesForMcp } from '../server/utils/page-live-source'

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
    expect(h.created).toEqual([])
  })
})

describe('createPageForMcp (#4193)', () => {
  beforeEach(() => {
    h.wheres = []
    h.writes.mockClear()
    h.created = []
    h.rows = [
      { id: 'pA', teamId: 'team_A', path: '/pA/', depth: 0, title: 'Home', slug: 'home', translations: {} },
      { id: 'pA2', teamId: 'team_A', path: '/pA/pA2/', depth: 1, title: 'Sub', slug: 'sub', translations: {} },
      { id: 'pB', teamId: 'team_B', path: '/pB/', depth: 0, title: 'Secret', slug: 'secret', translations: {} }
    ]
    installDb()
  })

  // covers: T1
  it('inserts one draft row at the top level and returns its id', async () => {
    const out = await createPageForMcp('team_A', 'user_1', { locale: 'en', title: 'About', slug: 'about' })
    expect(out.error).toBeNull()
    expect(h.created).toHaveLength(1)
    const row = h.created[0]
    expect(out.data).toEqual({ pageId: row.id })
    expect(row).toMatchObject({
      teamId: 'team_A', status: 'draft', publishedAt: null, visibility: 'public', pageType: 'pages:regular',
      title: 'About', slug: 'about', parentId: null, path: `/${row.id}/`, depth: 0,
      owner: 'user_1', createdBy: 'user_1', updatedBy: 'user_1'
    })
    expect(row.translations.en).toMatchObject({ title: 'About', slug: 'about' })
    // Through the collection's insert only, never a raw useDB write
    expect(h.writes).not.toHaveBeenCalled()
  })

  // covers: T2
  it('stores the blocks as a TipTap doc in the locale and the base content', async () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]
    await createPageForMcp('team_A', 'user_1', { locale: 'en', title: 'About', slug: 'about', blocks })
    const row = h.created[0]
    expect(JSON.parse(row.translations.en.content)).toEqual({ type: 'doc', content: blocks })
    expect(JSON.parse(row.content)).toEqual({ type: 'doc', content: blocks })
    // The read side then returns exactly that doc
    expect(await getStoredPageContentForMcp('team_A', row.id, 'en')).toEqual({
      id: row.id, locale: 'en', content: { type: 'doc', content: blocks }
    })
  })

  // covers: T3
  it('under a parent of the team: path = parent path + id + /, depth = parent + 1', async () => {
    await createPageForMcp('team_A', 'user_1', { locale: 'en', title: 'Deep', slug: 'deep', parentId: 'pA2' })
    const row = h.created[0]
    expect(row).toMatchObject({ parentId: 'pA2', path: `/pA/pA2/${row.id}/`, depth: 2 })
  })

  // covers: T3
  it('an unknown or other-team parentId refuses with parent_not_found and writes nothing', async () => {
    expect(await createPageForMcp('team_A', 'user_1', { locale: 'en', title: 'X', slug: 'x', parentId: 'pB' }))
      .toEqual({ data: null, error: 'parent_not_found' })
    expect(await createPageForMcp('team_A', 'user_1', { locale: 'en', title: 'X', slug: 'x', parentId: 'nope' }))
      .toEqual({ data: null, error: 'parent_not_found' })
    expect(h.created).toEqual([])
  })

  // covers: T4
  it('a slug already used in the team refuses with slug_taken and writes nothing', async () => {
    expect(await createPageForMcp('team_A', 'user_1', { locale: 'en', title: 'Home 2', slug: 'home' }))
      .toEqual({ data: null, error: 'slug_taken' })
    expect(h.created).toEqual([])
    // The same slug in ANOTHER team is free
    expect((await createPageForMcp('team_B', 'user_1', { locale: 'en', title: 'Home', slug: 'home' })).error).toBeNull()
  })

  // covers: T9
  it('stores every given setting and stays a draft even if status/publishedAt are smuggled in', async () => {
    await createPageForMcp('team_A', 'user_1', {
      locale: 'en', title: 'Members', slug: 'members',
      visibility: 'members', seoTitle: 'SEO t', seoDescription: 'SEO d', robots: 'noindex',
      showInNavigation: true, config: { hideNav: true },
      ...({ status: 'published', publishedAt: new Date() } as any)
    })
    const row = h.created[0]
    expect(row).toMatchObject({
      visibility: 'members', seoTitle: 'SEO t', seoDescription: 'SEO d', robots: 'noindex',
      showInNavigation: true, config: { hideNav: true }, status: 'draft', publishedAt: null
    })
    expect(row.translations.en).toMatchObject({ seoTitle: 'SEO t', seoDescription: 'SEO d' })
  })
})
