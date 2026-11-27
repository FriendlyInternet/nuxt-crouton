/**
 * #4193 — `create_page`, tool side (Rule C: a new page is always a draft; Rule A:
 * only for a user who may edit that team's pages). The page source is a fake with
 * the real contract — `createPageForMcp` pushes a draft into the same `pages`
 * array `listTeamPagesForMcp` / `getStoredPageContentForMcp` read, and refuses an
 * unknown parent or a taken slug. The real helper (path/depth, draft, the
 * smuggled-status case, no write on refusal) runs in crouton-pages'
 * page-live-source.test.ts. The tool's real input schema and its real `/mcp`
 * handler file are imported below.
 */
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { createPageTool, listPagesTool, readPageTool, type PagesToolDeps } from '../server/mcp-pages/lib/tools'
import { registeredPageTypes } from '../server/mcp-pages/lib/page-types'

const deps0 = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.defineMcpTool = (def: unknown) => def
  return { calls: [] as string[] }
})
vi.mock('../server/mcp-pages/lib/deps', () => ({
  pagesToolDeps: () => ({ pages: { createPageForMcp: async () => { deps0.calls.push('createPageForMcp'); return { data: null, error: null } } } }),
  pagesAccess: () => undefined
}))

import createPage, { createPageInputSchema } from '../server/mcp-pages/tools/create-page'

const ctxA = { userId: 'user_1', tokenId: 'tok1' }
const A = 'team-a'
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

/** team_A: user_1 is admin · team_B: not a member · team_Z: plain member. */
const teams = [
  { id: 'team_A', slug: 'team-a', name: 'Team A' },
  { id: 'team_B', slug: 'team-b', name: 'Team B' },
  { id: 'team_Z', slug: 'team-z', name: 'Team Z' }
]
const roles: Record<string, Record<string, string>> = { user_1: { team_A: 'admin', team_Z: 'member' } }

function makeDeps() {
  const pages: any[] = [
    { id: 'pA', teamId: 'team_A', slug: 'home', path: '/pA/', depth: 0, status: 'published', translations: { en: { title: 'Home', slug: 'home', content: '{"type":"doc","content":[]}' } } },
    { id: 'pB', teamId: 'team_B', slug: 'secret', path: '/pB/', depth: 0, status: 'published', translations: {} }
  ]
  let n = 0
  const deps: PagesToolDeps = {
    teams: {
      findTeam: vi.fn(async (x: string) => teams.find(t => t.id === x) ?? teams.find(t => t.slug === x) ?? null),
      canEditPages: vi.fn(async (teamId: string, userId: string) => ['admin', 'owner'].includes(roles[userId]?.[teamId] ?? '')),
      listUserTeams: vi.fn(async () => [])
    },
    pages: {
      listTeamPagesForMcp: vi.fn(async (teamId: string) => pages.filter(p => p.teamId === teamId).map(p => ({ id: p.id, status: p.status }))),
      getStoredPageContentForMcp: vi.fn(async (teamId: string, pageId: string, locale: string) => {
        const p = pages.find(x => x.id === pageId && x.teamId === teamId)
        const c = p?.translations?.[locale]?.content
        return p ? { id: p.id, locale, content: c ? JSON.parse(c) : null } : null
      }),
      createPageForMcp: vi.fn(async (teamId: string, userId: string, input: any) => {
        const parent = pages.find(p => p.id === input.parentId && p.teamId === teamId)
        const error = fakeCreateError(pages, teamId, input, parent)
        if (error) return { data: null, error }
        const id = `new${++n}`
        pages.push(fakeDraft(id, teamId, userId, input, parent))
        return { data: { pageId: id }, error: null }
      })
    },
    room: {
      readCollabRoomDoc: vi.fn(async () => ({ doc: null, error: null })),
      updateCollabRoomDoc: vi.fn(async () => ({ doc: null, error: 'unused' }))
    },
    registry: {},
    checkLayout: () => ({ ok: false, errors: ['unused'], warnings: [] }),
    defaultLocale: 'en',
    pageTypes: ['pages:regular', 'app:shopBikes-detail']
  }
  return { deps, pages }
}

/** The fake's refusals, mirroring the real helper's contract. */
function fakeCreateError(pages: any[], teamId: string, input: any, parent: any) {
  if (input.parentId && !parent) return 'parent_not_found' as const
  if (pages.some(p => p.teamId === teamId && p.slug === input.slug)) return 'slug_taken' as const
  return null
}

/** The draft row the fake stores (the real one is checked in crouton-pages). */
function fakeDraft(id: string, teamId: string, userId: string, input: any, parent: any) {
  const { locale, title, slug, parentId, blocks, ...settings } = input
  const content = JSON.stringify({ type: 'doc', content: blocks ?? [] })
  const place = parent
    ? { parentId, path: `${parent.path}${id}/`, depth: parent.depth + 1 }
    : { parentId: null, path: `/${id}/`, depth: 0 }
  return {
    ...settings, ...place, id, teamId, slug, title, content, status: 'draft', publishedAt: null,
    createdBy: userId, translations: { [locale]: { title, slug, content } }
  }
}

const json = (res: any) => JSON.parse(res.content[0].text)

function expectRefused(res: any, text: string | RegExp, deps: PagesToolDeps, pages: any[], before: number) {
  expect(res.isError).toBe(true)
  if (typeof text === 'string') expect(res.content[0].text).toBe(text)
  else expect(res.content[0].text).toMatch(text)
  expect(deps.pages.createPageForMcp).not.toHaveBeenCalled()
  expect(pages).toHaveLength(before)
}

describe('create_page — Rule C, a new page is always a draft (#4193)', () => {
  // covers: T1
  it('locale, title, slug → one new draft row in that team; returns its pageId', async () => {
    const { deps, pages } = makeDeps()
    const res = await createPageTool(ctxA, { team: A, locale: 'en', title: 'About', slug: 'about' }, deps)
    expect(res.isError).toBeUndefined()
    const out = json(res)
    expect(out).toMatchObject({ pageId: 'new1', status: 'draft' })
    expect(out.note).toMatch(/draft/)
    expect(deps.pages.createPageForMcp).toHaveBeenCalledWith('team_A', 'user_1', { locale: 'en', title: 'About', slug: 'about' })
    const row = pages.find(p => p.id === 'new1')
    expect(row).toMatchObject({ teamId: 'team_A', status: 'draft', publishedAt: null, path: '/new1/', depth: 0 })
    expect(row.translations.en).toMatchObject({ title: 'About', slug: 'about' })
  })

  // covers: T2
  it('with blocks → read_page on the new id returns those blocks (source: stored)', async () => {
    const { deps } = makeDeps()
    const blocks = [para('Hello'), para('World')]
    const { pageId } = json(await createPageTool(ctxA, { team: A, locale: 'en', title: 'About', slug: 'about', blocks }, deps))
    const read = json(await readPageTool(ctxA, { team: A, pageId, locale: 'en' }, deps))
    expect(read.source).toBe('stored')
    expect(read.doc).toEqual({ type: 'doc', content: blocks })
    expect(read.blocks.map((b: any) => b.text)).toEqual(['Hello', 'World'])
  })

  // covers: T3
  it('under a parent of the team → nested path/depth; an unknown or other team\'s parent → error, no row', async () => {
    const { deps, pages } = makeDeps()
    const { pageId } = json(await createPageTool(ctxA, { team: A, locale: 'en', title: 'Sub', slug: 'sub', parentId: 'pA' }, deps))
    expect(pages.find(p => p.id === pageId)).toMatchObject({ parentId: 'pA', path: `/pA/${pageId}/`, depth: 1 })
    for (const parentId of ['pB', 'nope']) {
      const before = pages.length
      const res = await createPageTool(ctxA, { team: A, locale: 'en', title: 'X', slug: `x-${parentId}`, parentId }, deps)
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toBe('parent page not found')
      expect(pages).toHaveLength(before)
    }
  })

  // covers: T4
  it('a slug already used in the team → error naming it, no row', async () => {
    const { deps, pages } = makeDeps()
    const res = await createPageTool(ctxA, { team: A, locale: 'en', title: 'Home again', slug: 'home' }, deps)
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toBe('slug "home" is already used in this team')
    expect(pages).toHaveLength(2)
  })

  // covers: T5
  it('invalid blocks → the existing invalid-blocks error, nothing created', async () => {
    const { deps, pages } = makeDeps()
    const res = await createPageTool(ctxA, { team: A, locale: 'en', title: 'X', slug: 'x', blocks: [{ type: 'text' }] }, deps)
    expectRefused(res, 'blocks[0] must be a TipTap block node: an object with a string "type" (not "doc" or "text")', deps, pages, 2)
  })

  // covers: T6
  it('no access, an unknown team, a team the user is not in, or only a member of → refused, nothing created', async () => {
    const { deps, pages } = makeDeps()
    expectRefused(await createPageTool(undefined, { team: A, locale: 'en', title: 'X', slug: 'x' }, deps), /Pas accès/, deps, pages, 2)
    for (const team of ['team-b', 'team_Z', 'unknown', '']) {
      const res = await createPageTool(ctxA, { team, locale: 'en', title: 'X', slug: 'x' }, deps)
      expectRefused(res, 'pas accès aux pages de cette équipe', deps, pages, 2)
    }
  })

  // covers: T7
  it('a locale other than the app default → error naming the default, nothing created', async () => {
    const { deps, pages } = makeDeps()
    const res = await createPageTool(ctxA, { team: A, locale: 'fr', title: 'X', slug: 'x' }, deps)
    expectRefused(res, /default locale "en"/, deps, pages, 2)
  })

  // covers: T8
  it('the created page shows in list_pages for that team, as a draft', async () => {
    const { deps } = makeDeps()
    const { pageId } = json(await createPageTool(ctxA, { team: A, locale: 'en', title: 'About', slug: 'about' }, deps))
    expect(json(await listPagesTool(ctxA, { team: A }, deps))).toContainEqual({ id: pageId, status: 'draft' })
  })

  // covers: T9
  it('settings are passed through as given and the page is still a draft', async () => {
    const { deps, pages } = makeDeps()
    const settings = {
      visibility: 'members', seoTitle: 'SEO t', seoDescription: 'SEO d', robots: 'noindex',
      showInNavigation: true, config: { hideNav: true }, pageType: 'app:shopBikes-detail'
    }
    const { pageId } = json(await createPageTool(ctxA, { team: A, locale: 'en', title: 'M', slug: 'm', ...settings }, deps))
    expect(pages.find(p => p.id === pageId)).toMatchObject({ ...settings, status: 'draft', publishedAt: null })
  })

  // covers: T10
  it('status / publishedAt are refused by the input schema AND by the tool, nothing created', async () => {
    const schema = z.object(createPageInputSchema)
    const base = { team: A, locale: 'en', title: 'X', slug: 'x' }
    expect(schema.safeParse(base).success).toBe(true)
    expect(schema.safeParse({ ...base, status: 'published' }).success).toBe(false)
    expect(schema.safeParse({ ...base, status: 'draft' }).success).toBe(false)
    expect(schema.safeParse({ ...base, publishedAt: '2026-01-01' }).success).toBe(false)

    const { deps, pages } = makeDeps()
    for (const extra of [{ status: 'published' }, { publishedAt: '2026-01-01' }]) {
      const res = await createPageTool(ctxA, { ...base, ...extra } as any, deps)
      expectRefused(res, /never publishes/, deps, pages, 2)
    }
  })

  // covers: T11
  it('an unknown pageType → error listing the known ones; an unknown visibility is refused by the schema', async () => {
    const { deps, pages } = makeDeps()
    const res = await createPageTool(ctxA, { team: A, locale: 'en', title: 'X', slug: 'x', pageType: 'nope:thing' }, deps)
    expectRefused(res, /unknown pageType "nope:thing"; known: pages:regular, app:shopBikes-detail/, deps, pages, 2)
    const schema = z.object(createPageInputSchema)
    expect(schema.safeParse({ team: A, locale: 'en', title: 'X', slug: 'x', visibility: 'everyone' }).success).toBe(false)
    expect(schema.safeParse({ team: A, locale: 'en', title: 'X', slug: 'x', visibility: 'scoped' }).success).toBe(true)
  })

  // covers: T6
  it('the real create_page handler without access is refused before the page source', async () => {
    const res = await (createPage as any).handler({ team: A, locale: 'en', title: 'X', slug: 'x' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/Pas accès/)
    expect(deps0.calls).toEqual([])
  })
})

describe('registeredPageTypes — the page types create_page accepts', () => {
  // covers: T11
  it('builds appId:typeId for every app and layer:collection-detail for publishable collections', () => {
    expect(registeredPageTypes({
      croutonApps: { pages: { id: 'pages', pageTypes: [{ id: 'regular' }] }, bookings: { id: 'bookings' } },
      croutonCollections: { shopBikes: { publishable: true }, events: { publishable: true, layer: 'events' }, pagesPages: {} }
    })).toEqual(['pages:regular', 'app:shopBikes-detail', 'events:events-detail'])
    expect(registeredPageTypes({})).toEqual([])
  })
})
