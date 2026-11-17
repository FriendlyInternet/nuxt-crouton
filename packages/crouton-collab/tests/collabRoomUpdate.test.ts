// @vitest-environment node
/**
 * #3982 T2 — the production room (CollabRoom DO) accepts an app-server edit:
 * POST /update with a valid room token applies it (then visible in /state),
 * GET /update is 405, and no token is 401.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { CollabRoom } from '../server/durable-objects/CollabRoom'
import { signCollabToken } from '../server/utils/collabToken'
import { tiptapToYFragment, yFragmentToTiptap } from '../shared/tiptap-yjs'

const SECRET = 'test-secret'
const ROOM_KEY = 'team_A:pagesPages:pagesPages-p1'

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

async function url(path: string, withToken = true) {
  const params = new URLSearchParams({ roomKey: ROOM_KEY })
  if (withToken) {
    params.set('token', await signCollabToken({ userId: 'mcp:tok1', teamId: 'team_A', room: ROOM_KEY }, SECRET))
  }
  return `https://collab.test${path}?${params}`
}

function headingUpdate(text: string): Uint8Array {
  const doc = new Y.Doc()
  tiptapToYFragment({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] }] }, doc.getXmlFragment('content-fr'))
  return Y.encodeStateAsUpdate(doc)
}

// covers: T2
describe('CollabRoom POST /update (#3982)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('applies a raw Yjs update with a valid room token, then /state contains the block', async () => {
    const room = makeRoom()
    const res = await room.fetch(new Request(await url('/update'), { method: 'POST', body: headingUpdate('From Claude') }))
    expect(res.status).toBe(200)

    const stateRes = await room.fetch(new Request(await url('/state')))
    expect(stateRes.status).toBe(200)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(await stateRes.arrayBuffer()))
    expect(yFragmentToTiptap(doc.getXmlFragment('content-fr')).content).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'From Claude' }] }
    ])
  })

  it('GET /update answers 405', async () => {
    const room = makeRoom()
    const res = await room.fetch(new Request(await url('/update')))
    expect(res.status).toBe(405)
  })

  it('POST /update without a token answers 401 and changes nothing', async () => {
    const room = makeRoom()
    const res = await room.fetch(new Request(await url('/update', false), { method: 'POST', body: headingUpdate('x') }))
    expect(res.status).toBe(401)
    const stateRes = await room.fetch(new Request(await url('/state')))
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(await stateRes.arrayBuffer()))
    expect(doc.getXmlFragment('content-fr').length).toBe(0)
  })

  it('POST /update with a token for another room answers 401', async () => {
    const room = makeRoom()
    const other = await signCollabToken({ userId: 'u', teamId: 'team_B', room: 'team_B:pagesPages:pagesPages-p1' }, SECRET)
    const res = await room.fetch(new Request(`https://collab.test/update?roomKey=${encodeURIComponent(ROOM_KEY)}&token=${encodeURIComponent(other)}`, { method: 'POST', body: headingUpdate('x') }))
    expect(res.status).toBe(401)
  })
})
