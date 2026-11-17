// @vitest-environment node
/**
 * #4094 — end to end: updateCollabRoomDoc (the app server) sends the editor's
 * presence with its diff, and the real CollabRoom (behind the worker's routing)
 * lists it with a caret that resolves inside the edited block of that locale.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as Y from 'yjs'
import { CollabRoom } from '../server/durable-objects/CollabRoom'
import { updateCollabRoomDoc } from '../server/utils/collabServerDoc'
import { caretForFragmentEdit, editYFragment, tiptapToYFragment, yFragmentToTiptap, type FragmentEditOp } from '../shared/tiptap-yjs'

const SECRET = 'test-secret'
const ref = { teamId: 'team_A', roomType: 'pagesPages', roomId: 'pagesPages-p1', actorId: 'mcp:tok1' }
const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

function makeRoom() {
  const store = new Map<string, unknown>()
  const state = {
    storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v) } },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn()
  }
  const env = { COLLAB_TOKEN_SECRET: SECRET, DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } }
  return new CollabRoom(state as never, env as never)
}

/** The worker template's routing: /{roomKey}/{action} → DO /{action}?roomKey=… */
function workerFetch(room: CollabRoom) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const u = new URL(input)
    const [key, action] = u.pathname.split('/').filter(Boolean)
    u.pathname = `/${action}`
    u.searchParams.set('roomKey', decodeURIComponent(key!))
    return room.fetch(new Request(u.toString(), init))
  })
}

afterEach(() => vi.unstubAllGlobals())

/** Resolve a caret JSON in `doc` → the top-level block index it sits in. */
function blockIndexOf(doc: Y.Doc, fragmentName: string, caretPos: unknown): number {
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(caretPos), doc)!
  const fragment = doc.getXmlFragment(fragmentName)
  let type: Y.AbstractType<any> = abs.type
  while (type.parent && type.parent !== fragment) type = type.parent as Y.AbstractType<any>
  return fragment.toArray().indexOf(type as never)
}

describe('presence through the real room (#4094)', () => {
  it('the room lists the presence and its caret resolves inside the inserted block', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok'))) // the room's operation posts
    const room = makeRoom()
    const doFetch = workerFetch(room)
    const options = { workerUrl: 'https://collab.test', secret: SECRET, fetch: doFetch as never }

    // A person's two paragraphs, then Claude inserts a heading at index 2 of content-fr
    await updateCollabRoomDoc(ref, (doc) => {
      tiptapToYFragment({ type: 'doc', content: [para('one'), para('two'), para('three')] }, doc.getXmlFragment('content-fr'))
    }, options)
    const op: FragmentEditOp = { action: 'insert', index: 2, blocks: [heading('From Claude')] }
    const out = await updateCollabRoomDoc(ref, doc => editYFragment(doc.getXmlFragment('content-fr'), op), {
      ...options,
      presence: (doc) => {
        const at = caretForFragmentEdit(doc.getXmlFragment('content-fr'), op)!
        return { clientId: 77, user: { id: 'mcp:tok1', name: 'Claude', color: '#d97757' }, caret: at.caret, fragment: 'content-fr', block: at.block }
      }
    })
    expect(out.error).toBeNull()

    const usersUrl = (doFetch.mock.calls[0]![0] as string).replace('/state?', '/users?')
    const { users } = await (await doFetch(usersUrl)).json() as { users: any[] }
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ clientId: 77, user: { name: 'Claude' }, fragment: 'content-fr', block: { index: 2, type: 'heading' } })

    // Resolve the caret in a fresh copy of the room's doc (what a browser has)
    const stateUrl = doFetch.mock.calls[0]![0] as string
    const browser = new Y.Doc()
    Y.applyUpdate(browser, new Uint8Array(await (await doFetch(stateUrl)).arrayBuffer()))
    expect(yFragmentToTiptap(browser.getXmlFragment('content-fr')).content[2]).toEqual(heading('From Claude'))
    expect(blockIndexOf(browser, 'content-fr', users[0].caret.anchor)).toBe(2)
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(users[0].caret.head), browser)!
    expect(abs.type).toBeInstanceOf(Y.XmlText)
    expect(abs.index).toBe('From Claude'.length) // end of the written block
  })

  it('a throwing presence callback never blocks the edit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
    const room = makeRoom()
    const doFetch = workerFetch(room)
    const out = await updateCollabRoomDoc(ref, doc => editYFragment(doc.getXmlFragment('content-fr'), { action: 'insert', index: 0, blocks: [heading('x')] }), {
      workerUrl: 'https://collab.test', secret: SECRET, fetch: doFetch as never,
      presence: () => { throw new Error('boom') }
    })
    expect(out.error).toBeNull()
    const post = doFetch.mock.calls[1]![1] as RequestInit
    expect((post.headers as Record<string, string>)['X-Collab-Presence']).toBeUndefined()
  })
})

describe('caretForFragmentEdit', () => {
  function fragmentWith(blocks: unknown[]) {
    const doc = new Y.Doc()
    const fragment = doc.getXmlFragment('content-en')
    tiptapToYFragment({ type: 'doc', content: blocks }, fragment)
    return { doc, fragment }
  }

  it('replace → end of the last replacing block', () => {
    const { doc, fragment } = fragmentWith([para('a'), para('b')])
    const op: FragmentEditOp = { action: 'replace', index: 0, count: 1, blocks: [heading('new')] }
    editYFragment(fragment, op)
    const at = caretForFragmentEdit(fragment, op)!
    expect(at.block).toEqual({ index: 0, type: 'heading' })
    expect(blockIndexOf(doc, 'content-en', at.caret.anchor)).toBe(0)
  })

  it('delete → before the block now at that index; emptied fragment → no block', () => {
    const { fragment } = fragmentWith([para('a'), para('b')])
    const op: FragmentEditOp = { action: 'delete', index: 0 }
    editYFragment(fragment, op)
    expect(caretForFragmentEdit(fragment, op)!.block).toEqual({ index: 0, type: 'paragraph' })
    editYFragment(fragment, op)
    expect(caretForFragmentEdit(fragment, op)!.block).toBeNull()
  })

  it('a block with no text (paneBlock) gets the gap before it', () => {
    const { doc, fragment } = fragmentWith([para('a')])
    const op: FragmentEditOp = { action: 'insert', index: 1, blocks: [{ type: 'paneBlock', attrs: { height: 480 } }] }
    editYFragment(fragment, op)
    const at = caretForFragmentEdit(fragment, op)!
    expect(at.block).toEqual({ index: 1, type: 'paneBlock' })
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(at.caret.anchor), doc)!
    expect(abs.type).toBe(fragment)
    expect(abs.index).toBe(1)
  })
})
