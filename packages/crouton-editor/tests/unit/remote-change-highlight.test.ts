import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { ySyncPlugin, yUndoPlugin, yUndoPluginKey, undo } from '@tiptap/y-tiptap'
import {
  classifyRemoteChange,
  createRemoteChangePlugin
} from '../../app/utils/remote-change-highlight'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }]
    },
    text: {}
  }
})

interface Window {
  doc: Y.Doc
  view: EditorView
}

const windows: Window[] = []

function mount(doc: Y.Doc): Window {
  const place = document.createElement('div')
  document.body.appendChild(place)
  const view = new EditorView(place, {
    state: EditorState.create({
      schema,
      plugins: [
        ySyncPlugin(doc.getXmlFragment('p')),
        yUndoPlugin(),
        createRemoteChangePlugin({ ghostMs: 400 })
      ]
    })
  })
  const w = { doc, view }
  windows.push(w)
  return w
}

/** Two docs synced both ways, like two browser windows in one room. */
function wire(a: Y.Doc, b: Y.Doc) {
  a.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(b, u, 'remote') })
  b.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(a, u, 'remote') })
}

const settle = () => new Promise(r => setTimeout(r, 50))

async function pair(): Promise<[Window, Window]> {
  const da = new Y.Doc()
  const db = new Y.Doc()
  wire(da, db)
  const a = mount(da)
  const b = mount(db)
  await settle()
  return [a, b]
}

const count = (w: Window, cls: string) => w.view.dom.querySelectorAll(`.${cls}`).length
const glows = (w: Window) => count(w, 'crouton-remote-new')
const ghosts = (w: Window) => count(w, 'crouton-remote-gone')

function typeAtEnd(w: Window, text: string, childIndex = 0) {
  const { doc } = w.view.state
  let pos = 0
  for (let i = 0; i <= childIndex; i++) pos += doc.child(i).nodeSize
  w.view.dispatch(w.view.state.tr.insertText(text, pos - 1))
}

function addParagraph(w: Window, text: string) {
  const end = w.view.state.doc.content.size
  w.view.dispatch(w.view.state.tr.insert(end, schema.node('paragraph', null, text ? schema.text(text) : undefined)))
}

function deleteChild(w: Window, childIndex: number) {
  const { doc } = w.view.state
  let pos = 0
  for (let i = 0; i < childIndex; i++) pos += doc.child(i).nodeSize
  w.view.dispatch(w.view.state.tr.delete(pos, pos + doc.child(childIndex).nodeSize))
}

afterEach(() => {
  vi.useRealTimers()
  while (windows.length) windows.pop()!.view.destroy()
  document.body.innerHTML = ''
})

describe('classifyRemoteChange', () => {
  const x = { id: 'x' }
  const y = { id: 'y' }
  const z = { id: 'z' }

  // covers: T4
  it('skips a missing meta, a non-remote change, force-rerender, local undo/redo and unknown prev', () => {
    expect(classifyRemoteChange(undefined, [x], [x, y])).toEqual({ skip: true })
    expect(classifyRemoteChange(null, [x], [x, y])).toEqual({ skip: true })
    expect(classifyRemoteChange({ isChangeOrigin: false }, [x], [x, y])).toEqual({ skip: true })
    expect(classifyRemoteChange({ isChangeOrigin: true, binding: {} }, [x], [x, y])).toEqual({ skip: true })
    expect(classifyRemoteChange({ isChangeOrigin: true, isUndoRedoOperation: true }, [x], [x, y])).toEqual({ skip: true })
    expect(classifyRemoteChange({ isChangeOrigin: true }, null, [x, y])).toEqual({ skip: true })
  })

  // covers: T1
  it('reports elements added and removed by a remote change', () => {
    expect(classifyRemoteChange({ isChangeOrigin: true }, [x, y], [x, z])).toEqual({ skip: false, added: [z], removed: [y] })
    expect(classifyRemoteChange({ isChangeOrigin: true }, new Set([x]), [x])).toEqual({ skip: false, added: [], removed: [] })
  })

  // covers: T4
  it('skips when the previous doc was empty (only the placeholder paragraph was shown)', () => {
    expect(classifyRemoteChange({ isChangeOrigin: true }, [], [x])).toEqual({ skip: true })
    expect(classifyRemoteChange({ isChangeOrigin: true }, new Set(), [x])).toEqual({ skip: true })
  })
})

describe('createRemoteChangePlugin with two synced editors', () => {
  // covers: T1
  it('a block added in A glows exactly once in B and never in A', async () => {
    const [a, b] = await pair()
    typeAtEnd(a, 'hello')
    expect(glows(b)).toBe(0)
    addParagraph(a, 'second')
    expect(b.view.state.doc.childCount).toBe(2)
    expect(glows(b)).toBe(1)
    expect(glows(a)).toBe(0)
    expect(b.view.dom.querySelector('.crouton-remote-new')!.textContent).toBe('second')
  })

  // covers: T2
  it('remote typing inside an existing block does not glow it', async () => {
    const [a, b] = await pair()
    typeAtEnd(a, 'hello')
    addParagraph(b, 'mine')
    expect(glows(b)).toBe(0)
    typeAtEnd(a, ' more', 1)
    expect(b.view.state.doc.child(1).textContent).toBe('mine more')
    expect(glows(b)).toBe(0)
    typeAtEnd(a, '!', 0)
    expect(glows(b)).toBe(0)
  })

  // covers: T3
  it('local typing, a local insert and a local undo never add a class or ghost in that window', async () => {
    const [a] = await pair()
    typeAtEnd(a, 'hello')
    addParagraph(a, 'second')
    // Close the undo group so undo only reverts the delete below.
    yUndoPluginKey.getState(a.view.state).undoManager.stopCapturing()
    deleteChild(a, 1)
    expect(a.view.state.doc.childCount).toBe(1)
    expect(glows(a)).toBe(0)
    expect(ghosts(a)).toBe(0)
    // Undo the local delete — y-sync applies it as isChangeOrigin + isUndoRedoOperation.
    expect(undo(a.view.state)).toBe(true)
    expect(a.view.state.doc.childCount).toBe(2)
    expect(glows(a)).toBe(0)
    expect(ghosts(a)).toBe(0)
  })

  // covers: T4
  it('the first load of a doc that already has blocks animates nothing', async () => {
    const da = new Y.Doc()
    const a = mount(da)
    await settle()
    typeAtEnd(a, 'one')
    addParagraph(a, 'two')
    addParagraph(a, 'three')
    const db = new Y.Doc()
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da), 'remote')
    const b = mount(db)
    await settle()
    expect(b.view.state.doc.childCount).toBe(3)
    expect(glows(b)).toBe(0)
    expect(ghosts(b)).toBe(0)
  })

  // covers: T5
  it('a block deleted in A leaves one fading ghost in B that is gone after 400 ms; a local delete leaves none', async () => {
    const [a, b] = await pair()
    typeAtEnd(a, 'one')
    addParagraph(a, 'two')
    addParagraph(a, 'three')
    vi.useFakeTimers()
    deleteChild(a, 1)
    expect(b.view.state.doc.childCount).toBe(2)
    expect(ghosts(a)).toBe(0)
    expect(ghosts(b)).toBe(1)
    const ghost = b.view.dom.querySelector('.crouton-remote-gone')!
    expect(ghost.textContent).toBe('two')
    // Sits at the old position: right before the next surviving block.
    expect(ghost.nextElementSibling?.textContent).toBe('three')
    vi.advanceTimersByTime(399)
    expect(ghosts(b)).toBe(1)
    vi.advanceTimersByTime(1)
    expect(ghosts(b)).toBe(0)
  })

  // covers: T1
  it('the glow class is dropped after the glow ends', async () => {
    const [a, b] = await pair()
    typeAtEnd(a, 'hello')
    vi.useFakeTimers()
    addParagraph(a, 'second')
    expect(glows(b)).toBe(1)
    vi.advanceTimersByTime(2400)
    expect(glows(b)).toBe(0)
  })
})
