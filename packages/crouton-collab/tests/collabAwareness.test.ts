import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { createCollabAwareness } from '../app/utils/collabAwareness'
import type { CollabAwarenessState } from '../app/types/collab'

// #3984 — the pages editor shares each person's caret/selection with the live room.

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    text: {}
  }
})

/** A ProseMirror state with one paragraph per string, selecting `from..to`. */
function pmState(paragraphs: string[], from: number, to: number): EditorState {
  const doc = schema.node('doc', null, paragraphs.map(t =>
    schema.node('paragraph', null, t ? [schema.text(t)] : [])))
  const state = EditorState.create({ doc, schema })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

const tick = () => new Promise<void>(resolve => queueMicrotask(resolve))

function setup(clientID = 7) {
  const sent: CollabAwarenessState[] = []
  // Same path as the real connection: whatever is sent goes over JSON
  const send = vi.fn((s: CollabAwarenessState) => { sent.push(JSON.parse(JSON.stringify(s))) })
  const awareness = createCollabAwareness({ clientID, send })
  return { awareness, sent, send }
}

describe('createCollabAwareness — sending (T1)', () => {
  it('sends nothing before a user is set', async () => {
    const { awareness, send } = setup()
    awareness.setLocalStateField('cursor', null)
    await tick()
    expect(send).not.toHaveBeenCalled()
  })

  it('coalesces user + cursor in one tick into ONE message with caret JSON and a null mouse cursor', async () => {
    const { awareness, sent, send } = setup(7)
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'hello world')
    const anchor = Y.createRelativePositionFromTypeIndex(text, 6)
    const head = Y.createRelativePositionFromTypeIndex(text, 11)

    awareness.setLocalStateField('user', { id: 'user-1', name: 'Alice', color: '#aabbcc' })
    awareness.setLocalStateField('cursor', { anchor, head })
    await tick()

    expect(send).toHaveBeenCalledTimes(1)
    const state = sent[0]!
    expect(state.user).toEqual({ id: 'user-1', name: 'Alice', color: '#aabbcc' })
    expect(state.clientId).toBe(7)
    expect(state.cursor).toBeNull()
    expect(state.caret).toEqual({
      anchor: Y.relativePositionToJSON(anchor),
      head: Y.relativePositionToJSON(head)
    })
  })

  it('falls back to client-<id> and a hex colour when the user has neither', async () => {
    const { awareness, sent } = setup(42)
    awareness.setLocalStateField('user', { name: 'Bob' })
    await tick()
    expect(sent[0]!.user.id).toBe('client-42')
    expect(sent[0]!.user.color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
})

describe('createCollabAwareness — receiving (T2)', () => {
  it('keys states by clientId, maps caret → cursor, converts colours, skips non-editor peers', () => {
    const { awareness } = setup(1)
    const caret = { anchor: { tname: 't', item: null, type: null, assoc: 0 }, head: { tname: 't', item: null, type: null, assoc: 0 } }
    awareness.receive([
      { user: { id: 'a', name: 'A', color: 'hsl(120, 65%, 45%)' }, cursor: null, clientId: 5, caret },
      { user: { id: 'flow', name: 'Flow' }, cursor: { x: 1, y: 2 } } // crouton-flow / a script
    ])
    const states = awareness.getStates()
    expect([...states.keys()]).toEqual([5])
    const a = states.get(5)! as any
    expect(a.cursor).toEqual(caret)
    expect(a.user.color).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(a.user.color).toBe('#28bd28')
  })

  it('fires change to on() listeners, not to ones removed with off()', () => {
    const { awareness } = setup()
    const kept = vi.fn()
    const removed = vi.fn()
    awareness.on('change', kept)
    awareness.on('change', removed)
    awareness.off('change', removed)
    awareness.receive([])
    expect(kept).toHaveBeenCalledTimes(1)
    expect(removed).not.toHaveBeenCalled()
  })
})

describe('createCollabAwareness — two editors, one connection (T3)', () => {
  it('shares the focused editor\'s fragment, block and text; an unfocused editor changes nothing', async () => {
    const { awareness, sent } = setup()
    const ydoc = new Y.Doc()
    const fr = ydoc.getXmlFragment('content-fr')
    const en = ydoc.getXmlFragment('content-en')
    awareness.setLocalStateField('user', { id: 'owner', name: 'Owner' })

    // "hello" = positions 1..6 in block 0; block 1 "hello world" starts at 7, text at 8.
    // "world" in block 1 = 8+6 .. 8+11 = 14..19
    const frState = pmState(['hello', 'hello world'], 14, 19)
    const enState = pmState(['bye'], 1, 4)

    awareness.setEditorSelection({ focused: true, fragment: fr, state: frState })
    awareness.setEditorSelection({ focused: false, fragment: en, state: enState })
    await tick()

    const last = sent.at(-1)!
    expect(last.fragment).toBe('content-fr')
    expect(last.selection).toEqual({ anchor: 14, head: 19 })
    expect(last.block).toEqual({ index: 1, type: 'paragraph' })
    expect(last.text).toBe('world')
  })

  it('switches fragment when the other editor takes focus, and clears text on an empty selection', async () => {
    const { awareness, sent } = setup()
    const ydoc = new Y.Doc()
    const en = ydoc.getXmlFragment('content-en')
    awareness.setLocalStateField('user', { id: 'owner', name: 'Owner' })
    awareness.setEditorSelection({ focused: true, fragment: en, state: pmState(['bye'], 2, 2) })
    await tick()
    expect(sent.at(-1)!.fragment).toBe('content-en')
    expect(sent.at(-1)!.text).toBeNull()
    expect(sent.at(-1)!.block).toEqual({ index: 0, type: 'paragraph' })
  })
})

describe('createCollabAwareness — others resolve it (T4)', () => {
  it('a peer resolves the relayed caret to the same text and sees the same fields', async () => {
    const docA = new Y.Doc()
    const textA = docA.getText('t')
    textA.insert(0, 'hello world')
    const docB = new Y.Doc()
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))

    const a = setup(docA.clientID)
    a.awareness.setLocalStateField('user', { id: 'a', name: 'A' })
    a.awareness.setLocalStateField('cursor', {
      anchor: Y.createRelativePositionFromTypeIndex(textA, 6),
      head: Y.createRelativePositionFromTypeIndex(textA, 11)
    })
    a.awareness.setEditorSelection({
      focused: true,
      fragment: docA.getXmlFragment('content-fr'),
      state: pmState(['hello world'], 7, 12)
    })
    await tick()

    // The server relays states as JSON
    const relayed = JSON.parse(JSON.stringify(a.sent.at(-1)))
    const b = setup(docB.clientID)
    b.awareness.receive([relayed])
    const peer = b.awareness.getStates().get(docA.clientID)! as any

    const anchor = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(peer.cursor.anchor), docB)
    const head = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(peer.cursor.head), docB)
    expect(anchor?.index).toBe(6)
    expect(head?.index).toBe(11)
    expect(peer.fragment).toBe('content-fr')
    expect(peer.block).toEqual({ index: 0, type: 'paragraph' })
    expect(peer.text).toBe('world')
  })
})

describe('createCollabAwareness — reconnect (T5)', () => {
  it('resend() sends the last full state again', async () => {
    const { awareness, sent, send } = setup()
    awareness.setLocalStateField('user', { id: 'u', name: 'U' })
    await tick()
    awareness.resend()
    expect(send).toHaveBeenCalledTimes(2)
    expect(sent[1]).toEqual(sent[0])
  })
})
