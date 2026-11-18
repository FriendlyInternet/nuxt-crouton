// @vitest-environment node
/**
 * #3982 T3 — updateCollabRoomDoc sends only the diff to the collab worker
 * (GET /state then POST /update, nothing else is fetched), and in local mode
 * edits the in-process room and pushes to its peers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { updateCollabRoomDoc, readCollabRoomDoc, COLLAB_NOT_LIVE_ERROR } from '../server/utils/collabServerDoc'
import { getOrCreateRoom, clearRoom } from '../server/utils/collabRoomStore'
import { verifyCollabToken } from '../server/utils/collabToken'
import { editYFragment, tiptapToYFragment, yFragmentToTiptap } from '../shared/tiptap-yjs'

const SECRET = 'test-secret'
const ref = { teamId: 'team_A', roomType: 'pagesPages', roomId: 'pagesPages-p1', actorId: 'mcp:tok1' }
const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })

/** A fake collab worker holding one room doc that already has someone's paragraph. */
function fakeWorker() {
  const roomDoc = new Y.Doc()
  tiptapToYFragment({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'typed by a person' }] }] }, roomDoc.getXmlFragment('content-fr'))
  const posted: Uint8Array[] = []
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const u = new URL(input)
    if (u.pathname.endsWith('/state') && (init?.method ?? 'GET') === 'GET') {
      return new Response(Y.encodeStateAsUpdate(roomDoc))
    }
    if (u.pathname.endsWith('/update') && init?.method === 'POST') {
      const body = init.body as Uint8Array
      posted.push(body)
      Y.applyUpdate(roomDoc, body)
      return new Response('ok')
    }
    return new Response('Not found', { status: 404 })
  })
  return { roomDoc, posted, fetchMock }
}

// covers: T3
describe('updateCollabRoomDoc — worker mode', () => {
  it('GETs /state, POSTs only the diff to /update, and fetches nothing else', async () => {
    const { roomDoc, posted, fetchMock } = fakeWorker()
    const personClient = roomDoc.clientID

    const out = await updateCollabRoomDoc(ref, (doc) => {
      editYFragment(doc.getXmlFragment('content-fr'), { action: 'insert', index: 1, blocks: [heading('From Claude')] })
    }, { workerUrl: 'https://collab.test/', secret: SECRET, fetch: fetchMock as never })

    expect(out.error).toBeNull()
    const urls = fetchMock.mock.calls.map(c => c[0] as string)
    expect(urls).toHaveLength(2)
    const roomPath = `/${encodeURIComponent('team_A:pagesPages:pagesPages-p1')}`
    expect(new URL(urls[0]!).pathname).toBe(`${roomPath}/state`)
    expect(new URL(urls[1]!).pathname).toBe(`${roomPath}/update`)
    for (const u of urls) expect(new URL(u).origin).toBe('https://collab.test')

    // The token names exactly this room, for this team and actor
    const claims = await verifyCollabToken(new URL(urls[1]!).searchParams.get('token')!, SECRET)
    expect(claims).toEqual({ userId: 'mcp:tok1', teamId: 'team_A', room: 'team_A:pagesPages:pagesPages-p1' })

    // Only the diff: no struct from the person's client is re-sent
    expect(posted).toHaveLength(1)
    const decoded = Y.decodeUpdate(posted[0]!)
    expect(decoded.structs.length).toBeGreaterThan(0)
    expect(decoded.structs.every(s => s.id.client !== personClient)).toBe(true)

    // The room now has both
    expect(yFragmentToTiptap(roomDoc.getXmlFragment('content-fr')).content.map(n => n.type)).toEqual(['paragraph', 'heading'])
  })

  it('a throwing edit sends nothing and returns the error', async () => {
    const { posted, fetchMock } = fakeWorker()
    const out = await updateCollabRoomDoc(ref, (doc) => {
      editYFragment(doc.getXmlFragment('content-fr'), { action: 'delete', index: 9 })
    }, { workerUrl: 'https://collab.test', secret: SECRET, fetch: fetchMock as never })
    expect(out.error).toMatch(/out of range/)
    expect(posted).toHaveLength(0)
  })

  it('readCollabRoomDoc returns a snapshot via /state only', async () => {
    const { fetchMock } = fakeWorker()
    const out = await readCollabRoomDoc(ref, { workerUrl: 'https://collab.test', secret: SECRET, fetch: fetchMock as never })
    expect(out.error).toBeNull()
    expect(yFragmentToTiptap(out.doc!.getXmlFragment('content-fr')).content).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// covers: T3
describe('updateCollabRoomDoc — local mode', () => {
  beforeEach(() => clearRoom('pagesPages', 'team_A:pagesPages-p1'))

  it('edits the in-process room (team-prefixed key) and pushes the update to its peers', async () => {
    const fetchMock = vi.fn()
    const room = getOrCreateRoom('pagesPages', 'team_A:pagesPages-p1')
    const send = vi.fn()
    room.peers.add({ send })

    const out = await updateCollabRoomDoc(ref, (doc) => {
      editYFragment(doc.getXmlFragment('content-fr'), { action: 'insert', index: 0, blocks: [heading('Local')] })
    }, { workerUrl: null, allowLocal: true, fetch: fetchMock as never })

    expect(out.error).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(yFragmentToTiptap(room.doc.getXmlFragment('content-fr')).content).toEqual([heading('Local')])
    expect(send).toHaveBeenCalled()
    // What the peer received rebuilds the edit
    const peerDoc = new Y.Doc()
    for (const [update] of send.mock.calls) Y.applyUpdate(peerDoc, update as Uint8Array)
    expect(yFragmentToTiptap(peerDoc.getXmlFragment('content-fr')).content).toEqual([heading('Local')])
  })

  it('without a worker URL outside dev it refuses (never falls back to the record)', async () => {
    const fetchMock = vi.fn()
    const out = await updateCollabRoomDoc(ref, () => {}, { workerUrl: null, allowLocal: false, fetch: fetchMock as never })
    expect(out).toMatchObject({ doc: null, error: COLLAB_NOT_LIVE_ERROR })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
