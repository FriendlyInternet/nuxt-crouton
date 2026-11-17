/**
 * #3982 T8 — Rule A + B, tool side. The page source and the room are fakes with
 * the real contracts (team-scoped lookup; a room doc that `mutate` edits); the
 * real converter (crouton-collab shared/tiptap-yjs) runs inside them. The real
 * room helper is covered by crouton-collab's collabServerDoc.test.ts and the
 * real page source by crouton-pages' page-live-source.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { tiptapToYFragment, yFragmentToTiptap } from '@fyit/crouton-collab/shared/tiptap-yjs'
import { checkLayoutForPlacement } from '@fyit/crouton-layout/app/utils/layout-placement-check'
import {
  listPagesTool,
  readPageTool,
  editPageTool,
  addLayoutTool,
  listLayoutBlocksTool,
  type PagesToolDeps
} from '../server/mcp-pages/lib/tools'

const ctxA = { teamId: 'team_A', tokenId: 'tok1' }
const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const storedHome = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Video here' }] }] }

const pages = [
  { id: 'pA', teamId: 'team_A', content: JSON.stringify(storedHome) },
  { id: 'pB', teamId: 'team_B', content: JSON.stringify(storedHome) }
]

function makeDeps() {
  const rooms = new Map<string, Y.Doc>()
  const key = (r: any) => `${r.teamId}:${r.roomType}:${r.roomId}`
  const room = {
    readCollabRoomDoc: vi.fn(async (r: any) => {
      const doc = new Y.Doc()
      const live = rooms.get(key(r))
      if (live) Y.applyUpdate(doc, Y.encodeStateAsUpdate(live))
      return { doc, error: null }
    }),
    updateCollabRoomDoc: vi.fn(async (r: any, mutate: (d: Y.Doc) => void) => {
      if (!rooms.has(key(r))) rooms.set(key(r), new Y.Doc())
      const doc = rooms.get(key(r))!
      try {
        doc.transact(() => mutate(doc))
      } catch (e: any) {
        return { doc: null, error: e.message }
      }
      return { doc, error: null }
    })
  }
  const deps: PagesToolDeps = {
    pages: {
      listTeamPagesForMcp: vi.fn(async (teamId: string) => pages.filter(p => p.teamId === teamId).map(p => ({ id: p.id }))),
      getStoredPageContentForMcp: vi.fn(async (teamId: string, pageId: string, locale: string) => {
        const p = pages.find(x => x.id === pageId && x.teamId === teamId)
        return p ? { id: p.id, locale, content: JSON.parse(p.content) } : null
      })
    },
    room,
    registry: {
      'calendar': { id: 'calendar', name: 'Calendar', minWidth: 500 },
      'bookings-list': { id: 'bookings-list', name: 'Bookings', minWidth: 320, configSchema: [{ name: 'limit' }] }
    },
    checkLayout: checkLayoutForPlacement
  }
  return { deps, room, rooms }
}

const json = (res: any) => JSON.parse(res.content[0].text)
const calendarBesideBookings = {
  renderer: 'panes',
  root: { type: 'split', direction: 'horizontal', children: [
    { type: 'leaf', blockId: 'calendar', defaultSize: 50 },
    { type: 'leaf', blockId: 'bookings-list', defaultSize: 50 }
  ] }
}

// Rule B witnesses: nothing may call $fetch or write through useDB
const fetchSpy = vi.fn()
const writes = { update: vi.fn(), insert: vi.fn(), delete: vi.fn() }

beforeEach(() => {
  vi.stubGlobal('$fetch', fetchSpy)
  vi.stubGlobal('useDB', () => ({ ...writes, select: vi.fn() }))
  fetchSpy.mockClear()
  writes.update.mockClear()
  writes.insert.mockClear()
  writes.delete.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

function expectNoRecordWrites() {
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(writes.update).not.toHaveBeenCalled()
  expect(writes.insert).not.toHaveBeenCalled()
  expect(writes.delete).not.toHaveBeenCalled()
}

// covers: T8
describe('Rule A — team isolation', () => {
  it('another team\'s page is "page not found" and no room is touched', async () => {
    const { deps, room } = makeDeps()
    for (const res of [
      await readPageTool(ctxA, { pageId: 'pB', locale: 'fr' }, deps),
      await editPageTool(ctxA, { pageId: 'pB', locale: 'fr', action: 'insert', index: 0, blocks: [heading('x')] }, deps),
      await addLayoutTool(ctxA, { pageId: 'pB', locale: 'fr', index: 0, layout: calendarBesideBookings }, deps)
    ]) {
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toBe('page not found')
    }
    expect(room.readCollabRoomDoc).not.toHaveBeenCalled()
    expect(room.updateCollabRoomDoc).not.toHaveBeenCalled()
  })

  it('a stray teamId argument is ignored: the room call carries the token\'s team', async () => {
    const { deps, room } = makeDeps()
    const args = { pageId: 'pA', locale: 'fr', action: 'insert', index: 1, blocks: [heading('x')], teamId: 'team_B' } as any
    const res = await editPageTool(ctxA, args, deps)
    expect(res.isError).toBeUndefined()
    expect(deps.pages.getStoredPageContentForMcp).toHaveBeenCalledWith('team_A', 'pA', 'fr')
    expect(room.updateCollabRoomDoc.mock.calls[0]![0]).toMatchObject({ teamId: 'team_A', roomId: 'pagesPages-pA' })
  })

  it('no ctx → error and no deps called', async () => {
    const { deps, room } = makeDeps()
    for (const res of [
      await listPagesTool(undefined, deps),
      await readPageTool(undefined, { pageId: 'pA', locale: 'fr' }, deps),
      await editPageTool(undefined, { pageId: 'pA', locale: 'fr', action: 'delete', index: 0 }, deps),
      await addLayoutTool(undefined, { pageId: 'pA', locale: 'fr', index: 0, layout: calendarBesideBookings }, deps)
    ]) expect(res.isError).toBe(true)
    expect(deps.pages.listTeamPagesForMcp).not.toHaveBeenCalled()
    expect(deps.pages.getStoredPageContentForMcp).not.toHaveBeenCalled()
    expect(room.readCollabRoomDoc).not.toHaveBeenCalled()
    expect(room.updateCollabRoomDoc).not.toHaveBeenCalled()
  })

  it('list_pages lists only the token\'s team', async () => {
    const { deps } = makeDeps()
    expect(json(await listPagesTool(ctxA, deps))).toEqual([{ id: 'pA' }])
  })
})

// covers: T8
describe('Rule B — edits go into the live room only', () => {
  it('edit_page seeds an empty room from the stored page, inserts, and writes no record', async () => {
    const { deps, room, rooms } = makeDeps()
    const res = await editPageTool(ctxA, { pageId: 'pA', locale: 'fr', action: 'insert', index: 1, blocks: [heading('Under the video')] }, deps)
    expect(res.isError).toBeUndefined()
    expect(room.updateCollabRoomDoc).toHaveBeenCalledTimes(1)
    expect(room.updateCollabRoomDoc.mock.calls[0]![0]).toEqual({ teamId: 'team_A', roomType: 'pagesPages', roomId: 'pagesPages-pA', actorId: 'mcp:tok1' })
    const live = yFragmentToTiptap(rooms.get('team_A:pagesPages:pagesPages-pA')!.getXmlFragment('content-fr'))
    expect(live.content).toEqual([storedHome.content[0], heading('Under the video')])
    expect(json(res).blocks.map((b: any) => b.text)).toEqual(['Video here', 'Under the video'])
    expectNoRecordWrites()
  })

  it('edit_page on a room that already has content does not re-seed', async () => {
    const { deps, rooms } = makeDeps()
    const doc = new Y.Doc()
    tiptapToYFragment({ type: 'doc', content: [heading('Typed live')] }, doc.getXmlFragment('content-fr'))
    rooms.set('team_A:pagesPages:pagesPages-pA', doc)
    await editPageTool(ctxA, { pageId: 'pA', locale: 'fr', action: 'insert', index: 1, blocks: [heading('Added')] }, deps)
    expect(yFragmentToTiptap(doc.getXmlFragment('content-fr')).content).toEqual([heading('Typed live'), heading('Added')])
  })

  it('edit_page refuses a block that is not a TipTap node, without touching the room', async () => {
    const { deps, room } = makeDeps()
    const res = await editPageTool(ctxA, { pageId: 'pA', locale: 'fr', action: 'insert', index: 0, blocks: [{ type: 'doc' }] }, deps)
    expect(res.isError).toBe(true)
    expect(room.updateCollabRoomDoc).not.toHaveBeenCalled()
  })

  it('add_layout inserts a paneBlock with the checked tree and returns the narrow-width warnings', async () => {
    const { deps, room, rooms } = makeDeps()
    const res = await addLayoutTool(ctxA, { pageId: 'pA', locale: 'fr', index: 1, layout: calendarBesideBookings }, deps)
    expect(res.isError).toBeUndefined()
    expect(room.updateCollabRoomDoc.mock.calls[0]![0]).toMatchObject({ roomId: 'pagesPages-pA' })
    const live = yFragmentToTiptap(rooms.get('team_A:pagesPages:pagesPages-pA')!.getXmlFragment('content-fr'))
    expect(live.content[1]).toMatchObject({ type: 'paneBlock', attrs: { height: 480, layout: { root: { type: 'split' } } } })
    expect(json(res).warnings.length).toBeGreaterThan(0)
    expectNoRecordWrites()
  })

  it('add_layout refuses an unknown block or a tree not viable at 1280 without touching the room', async () => {
    const { deps, room } = makeDeps()
    const bad = await addLayoutTool(ctxA, { pageId: 'pA', locale: 'fr', index: 0, layout: { renderer: 'panes', root: { type: 'leaf', blockId: 'nope' } } }, deps)
    expect(bad.isError).toBe(true)
    expect(bad.content[0]!.text).toContain('nope')
    expect(room.updateCollabRoomDoc).not.toHaveBeenCalled()
  })

  it('read_page reads stored content until the room has some, then live', async () => {
    const { deps } = makeDeps()
    expect(json(await readPageTool(ctxA, { pageId: 'pA', locale: 'fr' }, deps)).source).toBe('stored')
    await editPageTool(ctxA, { pageId: 'pA', locale: 'fr', action: 'insert', index: 0, blocks: [heading('Top')] }, deps)
    const res = json(await readPageTool(ctxA, { pageId: 'pA', locale: 'fr' }, deps))
    expect(res.source).toBe('live')
    expect(res.blocks.map((b: any) => b.index)).toEqual([0, 1])
    expectNoRecordWrites()
  })

  it('list_layout_blocks lists the registry with sizing and config names', () => {
    const { deps } = makeDeps()
    expect(json(listLayoutBlocksTool(deps))).toContainEqual(expect.objectContaining({ id: 'bookings-list', minWidth: 320, config: ['limit'] }))
  })
})
