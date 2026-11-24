/**
 * #3982 / #4097 — Rule A + B, tool side. The team lookups, the page source and the
 * room are fakes with the real contracts (team by id or slug; `canEditPages` =
 * admin/owner; team-scoped page lookup; a room doc that `mutate` edits); the real
 * converter (crouton-collab shared/tiptap-yjs) runs inside them. The real team
 * wiring is covered by mcpPagesTeamLookup.test.ts and crouton-auth's
 * team-utils.test.ts, the real room helper by crouton-collab's
 * collabServerDoc.test.ts and the real page source by crouton-pages'
 * page-live-source.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { tiptapToYFragment, yFragmentToTiptap } from '@fyit/crouton-collab/shared/tiptap-yjs'
import { checkLayoutForPlacement } from '@fyit/crouton-layout/app/utils/layout-placement-check'
import {
  listTeamsTool,
  listPagesTool,
  readPageTool,
  editPageTool,
  addLayoutTool,
  listLayoutBlocksTool,
  type PagesToolDeps
} from '../server/mcp-pages/lib/tools'

/** The signed-in user (no team: the team is a tool argument). */
const ctxA = { userId: 'user_1', tokenId: 'tok1' }
const A = 'team-a'
const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const storedHome = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Video here' }] }] }

const pages = [
  { id: 'pA', teamId: 'team_A', content: JSON.stringify(storedHome) },
  { id: 'pB', teamId: 'team_B', content: JSON.stringify(storedHome) },
  { id: 'pZ', teamId: 'team_Z', content: JSON.stringify(storedHome) }
]

/** team_A: user_1 is admin · team_B: not a member · team_Z: plain member. */
const teams = [
  { id: 'team_A', slug: 'team-a', name: 'Team A' },
  { id: 'team_B', slug: 'team-b', name: 'Team B' },
  { id: 'team_Z', slug: 'team-z', name: 'Team Z' }
]
const roles: Record<string, Record<string, string>> = {
  user_1: { team_A: 'admin', team_Z: 'member' }
}

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
    teams: {
      findTeam: vi.fn(async (x: string) => teams.find(t => t.id === x) ?? teams.find(t => t.slug === x) ?? null),
      canEditPages: vi.fn(async (teamId: string, userId: string) => ['admin', 'owner'].includes(roles[userId]?.[teamId] ?? '')),
      listUserTeams: vi.fn(async (userId: string) => teams
        .filter(t => roles[userId]?.[t.id])
        .map(t => ({ ...t, role: roles[userId]![t.id]! })))
    },
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

function expectNoPageOrRoom(deps: PagesToolDeps, room: ReturnType<typeof makeDeps>['room']) {
  expect(deps.pages.listTeamPagesForMcp).not.toHaveBeenCalled()
  expect(deps.pages.getStoredPageContentForMcp).not.toHaveBeenCalled()
  expect(room.readCollabRoomDoc).not.toHaveBeenCalled()
  expect(room.updateCollabRoomDoc).not.toHaveBeenCalled()
}

describe('Rule A — the team is a tool argument, checked with canEditPages', () => {
  // covers: T2
  it('list_teams lists exactly the user\'s teams, each with canEditPages', async () => {
    const { deps, room } = makeDeps()
    expect(json(await listTeamsTool(ctxA, deps))).toEqual([
      { id: 'team_A', slug: 'team-a', name: 'Team A', role: 'admin', canEditPages: true },
      { id: 'team_Z', slug: 'team-z', name: 'Team Z', role: 'member', canEditPages: false }
    ])
    expect(deps.teams.listUserTeams).toHaveBeenCalledWith('user_1')
    expectNoPageOrRoom(deps, room)
  })

  // covers: T2
  it('list_pages { team } (admin) lists only that team\'s pages, by slug or id', async () => {
    const { deps } = makeDeps()
    expect(json(await listPagesTool(ctxA, { team: 'team-a' }, deps))).toEqual([{ id: 'pA' }])
    expect(json(await listPagesTool(ctxA, { team: 'team_A' }, deps))).toEqual([{ id: 'pA' }])
    expect(deps.teams.canEditPages).toHaveBeenCalledWith('team_A', 'user_1')
  })

  // covers: T3
  it('a team the user is not in, or only a plain member of, is refused before any page or room dep', async () => {
    for (const team of ['team-b', 'team-z', 'team_B', 'team_Z', 'unknown-team', '']) {
      const { deps, room } = makeDeps()
      for (const res of [
        await listPagesTool(ctxA, { team }, deps),
        await readPageTool(ctxA, { team, pageId: 'pB', locale: 'fr' }, deps),
        await editPageTool(ctxA, { team, pageId: 'pZ', locale: 'fr', action: 'insert', index: 0, blocks: [heading('x')] }, deps),
        await addLayoutTool(ctxA, { team, pageId: 'pZ', locale: 'fr', index: 0, layout: calendarBesideBookings }, deps)
      ]) {
        expect(res.isError, team).toBe(true)
        expect(res.content[0]!.text, team).toBe('pas accès aux pages de cette équipe')
      }
      expectNoPageOrRoom(deps, room)
    }
  })

  // covers: T3
  it('another team\'s page under the user\'s own team is "page not found" and no room is touched', async () => {
    const { deps, room } = makeDeps()
    for (const res of [
      await readPageTool(ctxA, { team: A, pageId: 'pB', locale: 'fr' }, deps),
      await editPageTool(ctxA, { team: A, pageId: 'pB', locale: 'fr', action: 'insert', index: 0, blocks: [heading('x')] }, deps),
      await addLayoutTool(ctxA, { team: A, pageId: 'pB', locale: 'fr', index: 0, layout: calendarBesideBookings }, deps)
    ]) {
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toBe('page not found')
    }
    expect(room.readCollabRoomDoc).not.toHaveBeenCalled()
    expect(room.updateCollabRoomDoc).not.toHaveBeenCalled()
  })

  // covers: T3
  it('a stray teamId argument is ignored: the room call carries the checked team\'s id', async () => {
    const { deps, room } = makeDeps()
    const args = { team: A, pageId: 'pA', locale: 'fr', action: 'insert', index: 1, blocks: [heading('x')], teamId: 'team_B' } as any
    const res = await editPageTool(ctxA, args, deps)
    expect(res.isError).toBeUndefined()
    expect(deps.pages.getStoredPageContentForMcp).toHaveBeenCalledWith('team_A', 'pA', 'fr')
    expect(room.updateCollabRoomDoc.mock.calls[0]![0]).toMatchObject({ teamId: 'team_A', roomId: 'pagesPages-pA' })
  })

  // covers: T3
  it('no ctx → error and no deps called', async () => {
    const { deps, room } = makeDeps()
    for (const res of [
      await listTeamsTool(undefined, deps),
      await listPagesTool(undefined, { team: A }, deps),
      await readPageTool(undefined, { team: A, pageId: 'pA', locale: 'fr' }, deps),
      await editPageTool(undefined, { team: A, pageId: 'pA', locale: 'fr', action: 'delete', index: 0 }, deps),
      await addLayoutTool(undefined, { team: A, pageId: 'pA', locale: 'fr', index: 0, layout: calendarBesideBookings }, deps),
      listLayoutBlocksTool(undefined, deps)
    ]) {
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toBe('Pas accès : connectez-vous via <origin>/mcp')
    }
    expect(deps.teams.findTeam).not.toHaveBeenCalled()
    expect(deps.teams.listUserTeams).not.toHaveBeenCalled()
    expectNoPageOrRoom(deps, room)
  })
})

// covers: T2
describe('Rule B — edits go into the live room only', () => {
  it('edit_page seeds an empty room from the stored page, inserts, and writes no record', async () => {
    const { deps, room, rooms } = makeDeps()
    const res = await editPageTool(ctxA, { team: A, pageId: 'pA', locale: 'fr', action: 'insert', index: 1, blocks: [heading('Under the video')] }, deps)
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
    await editPageTool(ctxA, { team: A, pageId: 'pA', locale: 'fr', action: 'insert', index: 1, blocks: [heading('Added')] }, deps)
    expect(yFragmentToTiptap(doc.getXmlFragment('content-fr')).content).toEqual([heading('Typed live'), heading('Added')])
  })

  it('edit_page refuses a block that is not a TipTap node, without touching the room', async () => {
    const { deps, room } = makeDeps()
    const res = await editPageTool(ctxA, { team: A, pageId: 'pA', locale: 'fr', action: 'insert', index: 0, blocks: [{ type: 'doc' }] }, deps)
    expect(res.isError).toBe(true)
    expect(room.updateCollabRoomDoc).not.toHaveBeenCalled()
  })

  it('add_layout inserts a paneBlock with the checked tree and returns the narrow-width warnings', async () => {
    const { deps, room, rooms } = makeDeps()
    const res = await addLayoutTool(ctxA, { team: A, pageId: 'pA', locale: 'fr', index: 1, layout: calendarBesideBookings }, deps)
    expect(res.isError).toBeUndefined()
    expect(room.updateCollabRoomDoc.mock.calls[0]![0]).toMatchObject({ roomId: 'pagesPages-pA' })
    const live = yFragmentToTiptap(rooms.get('team_A:pagesPages:pagesPages-pA')!.getXmlFragment('content-fr'))
    expect(live.content[1]).toMatchObject({ type: 'paneBlock', attrs: { height: 480, layout: { root: { type: 'split' } } } })
    expect(json(res).warnings.length).toBeGreaterThan(0)
    expectNoRecordWrites()
  })

  it('add_layout refuses an unknown block or a tree not viable at 1280 without touching the room', async () => {
    const { deps, room } = makeDeps()
    const bad = await addLayoutTool(ctxA, { team: A, pageId: 'pA', locale: 'fr', index: 0, layout: { renderer: 'panes', root: { type: 'leaf', blockId: 'nope' } } }, deps)
    expect(bad.isError).toBe(true)
    expect(bad.content[0]!.text).toContain('nope')
    expect(room.updateCollabRoomDoc).not.toHaveBeenCalled()
  })

  it('read_page reads stored content until the room has some, then live', async () => {
    const { deps } = makeDeps()
    expect(json(await readPageTool(ctxA, { team: A, pageId: 'pA', locale: 'fr' }, deps)).source).toBe('stored')
    await editPageTool(ctxA, { team: A, pageId: 'pA', locale: 'fr', action: 'insert', index: 0, blocks: [heading('Top')] }, deps)
    const res = json(await readPageTool(ctxA, { team: A, pageId: 'pA', locale: 'fr' }, deps))
    expect(res.source).toBe('live')
    expect(res.blocks.map((b: any) => b.index)).toEqual([0, 1])
    expectNoRecordWrites()
  })

  it('list_layout_blocks lists the registry with sizing and config names', () => {
    const { deps } = makeDeps()
    expect(json(listLayoutBlocksTool(ctxA, deps))).toContainEqual(expect.objectContaining({ id: 'bookings-list', minWidth: 320, config: ['limit'] }))
  })
})

/** The presence the tool handed the room for its latest edit, built on that room doc. */
function lastPresence(room: ReturnType<typeof makeDeps>['room'], rooms: Map<string, Y.Doc>) {
  const call = room.updateCollabRoomDoc.mock.calls.at(-1)! as any[]
  const doc = rooms.get(`${call[0].teamId}:${call[0].roomType}:${call[0].roomId}`)!
  return { presence: call[2]?.presence?.(doc), doc }
}

/** Which top-level block of `fragmentName` a caret JSON resolves inside. */
function blockIndexOf(doc: Y.Doc, fragmentName: string, pos: unknown): number {
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(pos), doc)!
  const fragment = doc.getXmlFragment(fragmentName)
  let type: any = abs.type
  while (type.parent && type.parent !== fragment) type = type.parent
  return fragment.toArray().indexOf(type)
}

// covers: T2
describe('Claude presence sent with an edit (#4094)', () => {
  it('edit_page insert at index 2 sends a presence whose caret resolves inside block 2 of that locale', async () => {
    const { deps, room, rooms } = makeDeps()
    await editPageTool(ctxA, { pageId: 'pA', locale: 'fr', action: 'insert', index: 1, blocks: [heading('one')] }, deps)
    await editPageTool(ctxA, { pageId: 'pA', locale: 'fr', action: 'insert', index: 2, blocks: [heading('From Claude')] }, deps)

    const { presence, doc } = lastPresence(room, rooms)
    expect(presence).toMatchObject({
      user: { id: 'mcp:tok1', name: 'Claude', color: '#d97757' },
      fragment: 'content-fr',
      block: { index: 2, type: 'heading' }
    })
    expect(blockIndexOf(doc, 'content-fr', presence.caret.anchor)).toBe(2)
    expect(blockIndexOf(doc, 'content-fr', presence.caret.head)).toBe(2)
    // Not the other locale's fragment
    expect(doc.getXmlFragment('content-en').length).toBe(0)
    expectNoRecordWrites()
  })

  it('the clientId is stable per pages token and differs between tokens', async () => {
    const { deps, room, rooms } = makeDeps()
    await editPageTool(ctxA, { pageId: 'pA', locale: 'fr', action: 'insert', index: 0, blocks: [heading('a')] }, deps)
    const first = lastPresence(room, rooms).presence.clientId
    await editPageTool(ctxA, { pageId: 'pA', locale: 'fr', action: 'delete', index: 0 }, deps)
    expect(lastPresence(room, rooms).presence.clientId).toBe(first)
    await editPageTool({ teamId: 'team_A', tokenId: 'tok2' }, { pageId: 'pA', locale: 'fr', action: 'insert', index: 0, blocks: [heading('b')] }, deps)
    expect(lastPresence(room, rooms).presence.clientId).not.toBe(first)
    expect(Number.isSafeInteger(first)).toBe(true)
  })

  it('add_layout puts the caret at the inserted pane block', async () => {
    const { deps, room, rooms } = makeDeps()
    await addLayoutTool(ctxA, { pageId: 'pA', locale: 'fr', index: 1, layout: calendarBesideBookings }, deps)
    expect(lastPresence(room, rooms).presence.block).toEqual({ index: 1, type: 'paneBlock' })
  })
})
