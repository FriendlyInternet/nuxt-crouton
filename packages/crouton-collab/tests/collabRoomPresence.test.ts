// @vitest-environment node
/**
 * #4094 — a server editor's presence (Claude via the MCP pages tools) rides on
 * POST /update. The rule: it is never a session — it can't write, it never
 * makes the room "active", and it expires by itself 5 s after its last update.
 *
 * Runs the real CollabRoom fetch handler; sessions are attached through the
 * room's own handleSession with a fake socket (node has no WebSocketPair).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { CollabRoom } from '../server/durable-objects/CollabRoom'
import { signCollabToken } from '../server/utils/collabToken'
import { COLLAB_PRESENCE_HEADER, encodeServerPresence, parseServerPresence, SERVER_PRESENCE_TTL_MS } from '../server/utils/collabServerPresence'
import { tiptapToYFragment } from '../shared/tiptap-yjs'

const SECRET = 'test-secret'
const ROOM_KEY = 'team_A:pagesPages:pagesPages-p1'

const claude = {
  clientId: 4242,
  user: { id: 'mcp:tok1', name: 'Claude', color: '#d97757' },
  caret: { anchor: { type: { client: 1, clock: 0 }, tname: null, item: null, assoc: 0 }, head: { type: { client: 1, clock: 0 }, tname: null, item: null, assoc: 0 } },
  fragment: 'content-fr',
  block: { index: 0, type: 'heading' }
}

function makeRoom() {
  const store = new Map<string, unknown>()
  const state = {
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => { store.set(k, v) }
    },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn()
  }
  const env = {
    COLLAB_TOKEN_SECRET: SECRET,
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) }
  }
  return new CollabRoom(state as never, env as never)
}

class FakeSocket {
  readyState = 1
  sent: unknown[] = []
  listeners: Record<string, ((e: any) => void)[]> = {}
  accept() {}
  send(data: unknown) { this.sent.push(data) }
  addEventListener(type: string, cb: (e: any) => void) { (this.listeners[type] ??= []).push(cb) }
  emit(type: string, e: unknown = {}) { for (const cb of this.listeners[type] ?? []) cb(e) }
  /** The `users` of the last awareness message this socket received. */
  lastUsers(): any[] | undefined {
    const msgs = this.sent.filter((d): d is string => typeof d === 'string').map(d => JSON.parse(d)).filter(m => m.type === 'awareness')
    return msgs.at(-1)?.users
  }
}

async function url(path: string) {
  const params = new URLSearchParams({ roomKey: ROOM_KEY })
  params.set('token', await signCollabToken({ userId: 'mcp:tok1', teamId: 'team_A', room: ROOM_KEY }, SECRET))
  return `https://collab.test${path}?${params}`
}

function headingUpdate(text: string): Uint8Array {
  const doc = new Y.Doc()
  tiptapToYFragment({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] }] }, doc.getXmlFragment('content-fr'))
  return Y.encodeStateAsUpdate(doc)
}

async function postUpdate(room: CollabRoom, body: Uint8Array, presence: unknown = claude) {
  const headers: Record<string, string> = {}
  if (presence) headers[COLLAB_PRESENCE_HEADER] = encodeServerPresence(presence as never)
  return room.fetch(new Request(await url('/update'), { method: 'POST', body, headers }))
}

async function stateOf(room: CollabRoom): Promise<Uint8Array> {
  const res = await room.fetch(new Request(await url('/state')))
  return new Uint8Array(await res.arrayBuffer())
}

async function usersOf(room: CollabRoom): Promise<any[]> {
  const res = await room.fetch(new Request(await url('/users')))
  return (await res.json() as { users: any[] }).users
}

function operationTypes(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .filter(c => String(c[0]).endsWith('/api/_crouton/operation'))
    .map(c => JSON.parse((c[1] as RequestInit).body as string).type)
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn(async () => new Response('ok'))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('WebSocket', { OPEN: 1 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// covers: T1
describe('CollabRoom server presence (#4094)', () => {
  it('a /update with presence is in the next awareness broadcast and in /users, then gone after 5 s', async () => {
    const room = makeRoom()
    await room.fetch(new Request(await url('/state'))) // initialise the room
    const ws = new FakeSocket()
    await (room as any).handleSession(ws, 'person-1', 'team_A')
    ws.emit('message', { data: JSON.stringify({ type: 'awareness', userId: 'person-1', state: { user: { id: 'person-1', name: 'Ann', color: '#ff0000' }, clientId: 1, cursor: null } }) })
    await vi.advanceTimersByTimeAsync(0)

    const res = await postUpdate(room, headingUpdate('From Claude'))
    expect(res.status).toBe(200)

    const users = ws.lastUsers()!
    expect(users.map(u => u.user.name)).toEqual(['Ann', 'Claude'])
    const sent = users.find(u => u.user.name === 'Claude')
    expect(sent).toMatchObject({ clientId: 4242, user: claude.user, caret: claude.caret, fragment: 'content-fr', block: claude.block, cursor: null, server: true })
    expect((await usersOf(room)).map(u => u.user.name)).toEqual(['Ann', 'Claude'])

    await vi.advanceTimersByTimeAsync(SERVER_PRESENCE_TTL_MS - 100)
    expect(ws.lastUsers()!.map(u => u.user.name)).toEqual(['Ann', 'Claude'])

    await vi.advanceTimersByTimeAsync(200)
    expect(ws.lastUsers()!.map(u => u.user.name)).toEqual(['Ann'])
    expect((await usersOf(room)).map(u => u.user.name)).toEqual(['Ann'])
  })

  it('a later edit keeps the presence alive: expiry counts from the last update', async () => {
    const room = makeRoom()
    const ws = new FakeSocket()
    await room.fetch(new Request(await url('/state')))
    await (room as any).handleSession(ws, 'person-1', 'team_A')

    await postUpdate(room, headingUpdate('one'))
    await vi.advanceTimersByTimeAsync(4_000)
    await postUpdate(room, headingUpdate('two'))
    await vi.advanceTimersByTimeAsync(4_000)
    expect(ws.lastUsers()!.map(u => u.user.name)).toEqual(['Claude'])
    await vi.advanceTimersByTimeAsync(1_100)
    expect(ws.lastUsers()).toEqual([])
  })

  it('with no sessions the room stays idle: no user-joined event, userCount stays 0', async () => {
    const room = makeRoom()
    const res = await postUpdate(room, headingUpdate('From Claude'))
    expect(res.status).toBe(200)
    expect((await usersOf(room)).map(u => u.user.name)).toEqual(['Claude'])
    const count = await (await room.fetch(new Request(await url('/users')))).json() as { count: number }
    expect(count.count).toBe(1) // listed, but…
    expect((room as any).sessions.size).toBe(0) // …never a session
    await vi.advanceTimersByTimeAsync(0) // let the signed operation posts go out
    expect(operationTypes(fetchMock)).toContain('collab:room:created') // the observer works…
    expect(operationTypes(fetchMock)).not.toContain('collab:user:joined') // …and the room never went active

    await vi.advanceTimersByTimeAsync(SERVER_PRESENCE_TTL_MS + 10)
    expect(await usersOf(room)).toEqual([])
  })

  it('a malformed presence is ignored and the edit still applies', async () => {
    const room = makeRoom()
    const res = await postUpdate(room, headingUpdate('x'), { clientId: 'nope', user: { name: 'Claude', color: 'red' } })
    expect(res.status).toBe(200)
    expect(await usersOf(room)).toEqual([])
    const doc = new Y.Doc()
    Y.applyUpdate(doc, await stateOf(room))
    expect(doc.getXmlFragment('content-fr').length).toBe(1)
  })
})

// covers: T3
describe('presence-only /update (#4094)', () => {
  it('an empty diff with presence answers 200 and changes no document state', async () => {
    const room = makeRoom()
    await postUpdate(room, headingUpdate('kept'), null)
    const before = await stateOf(room)

    const res = await postUpdate(room, new Uint8Array(0))
    expect(res.status).toBe(200)
    expect(await stateOf(room)).toEqual(before)
    expect((await usersOf(room)).map(u => u.user.name)).toEqual(['Claude'])
  })

  it('an empty body without presence is still 400', async () => {
    const room = makeRoom()
    const res = await postUpdate(room, new Uint8Array(0), null)
    expect(res.status).toBe(400)
  })
})

describe('parseServerPresence', () => {
  it('whitelists the fields and drops anything else', () => {
    const parsed = parseServerPresence(encodeServerPresence({ ...claude, evil: 'x' } as never))
    expect(parsed).toEqual({ ...claude, cursor: null, server: true })
  })
  it('refuses a missing user, a bad colour or an oversize header', () => {
    expect(parseServerPresence(encodeServerPresence({ clientId: 1 } as never))).toBeNull()
    expect(parseServerPresence(encodeServerPresence({ ...claude, user: { name: 'C', color: 'javascript:' } }))).toBeNull()
    expect(parseServerPresence('x'.repeat(5000))).toBeNull()
    expect(parseServerPresence('%E0%A4%A')).toBeNull()
  })
})
