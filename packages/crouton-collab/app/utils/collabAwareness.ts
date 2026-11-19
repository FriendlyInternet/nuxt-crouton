/**
 * A small y-protocols-style Awareness on top of crouton-collab's own WebSocket
 * connection (#3984).
 *
 * TipTap's collaboration caret (`yCursorPlugin` from `@tiptap/y-tiptap`) needs
 * `clientID`, `getStates()`, `getLocalState()`, `setLocalStateField()` and
 * `on/off('change')`. Our connection only has `sendAwareness`/`onAwareness`, so
 * this adapter bridges the two:
 *
 * - Locally it keeps the y-tiptap `cursor` field (a pair of `Y.RelativePosition`s).
 * - On the wire that becomes `caret` (relative-position JSON) and the mouse
 *   `cursor` is sent as `null`, so crouton-flow's `cursor: { x, y }` keeps its meaning.
 * - `setEditorSelection` adds what a reader of the room (e.g. Claude) needs to act on
 *   "change this": which language fragment, the absolute selection, the top-level
 *   block and the selected text. Only the FOCUSED editor writes it, so a second
 *   editor sharing the connection (i18n side-by-side) never overwrites it.
 *
 * Pure and Nuxt-free so it can be unit tested.
 */
import * as Y from 'yjs'
import type { CollabAwarenessState } from '../types/collab'
import { generateUserColor, toHexColor } from './avatar'

/** Max characters of selected text shared with the room. */
export const MAX_SHARED_TEXT = 500

/** The bits of a ProseMirror EditorState `setEditorSelection` reads. */
export interface EditorSelectionStateLike {
  selection: {
    anchor: number
    head: number
    from: number
    to: number
    $anchor: { index: (depth: number) => number }
  }
  doc: {
    childCount: number
    child: (index: number) => { type: { name: string } }
    textBetween: (from: number, to: number, blockSeparator?: string) => string
  }
}

export interface EditorSelectionSource {
  /** Is this editor the one the person is typing in? Unfocused calls are ignored. */
  focused: boolean
  /** The Y.XmlFragment the editor is bound to (its root name says which language). */
  fragment: Y.AbstractType<any> | null | undefined
  state: EditorSelectionStateLike
}

export interface CollabAwarenessAdapter {
  clientID: number
  getLocalState: () => Record<string, unknown> | null
  setLocalStateField: (field: string, value: unknown) => void
  getStates: () => Map<number, Record<string, unknown>>
  on: (event: 'change', callback: () => void) => void
  off: (event: 'change', callback: () => void) => void
  /** Feed the room's `users` list in (called by the connection). */
  receive: (users: CollabAwarenessState[]) => void
  /** Send the last full local state again (called on (re)connect). */
  resend: () => void
  /** Share the focused editor's selection, block, text and fragment. */
  setEditorSelection: (src: EditorSelectionSource) => void
}

export interface CreateCollabAwarenessOptions {
  clientID: number
  send: (state: CollabAwarenessState) => void
}

/** Root name of a Yjs type, e.g. `content-fr`, or null when it isn't a root type. */
function rootNameOf(type: Y.AbstractType<any> | null | undefined): string | null {
  const doc = type?.doc
  if (!type || !doc) return null
  for (const [name, value] of doc.share) {
    if (value === type) return name
  }
  return null
}

function toRelJSON(pos: unknown): unknown {
  return pos instanceof Y.RelativePosition ? Y.relativePositionToJSON(pos) : pos
}

export function createCollabAwareness(options: CreateCollabAwarenessOptions): CollabAwarenessAdapter {
  const { clientID, send } = options
  const local: Record<string, unknown> = {}
  let states = new Map<number, Record<string, unknown>>()
  const listeners: (() => void)[] = []
  let pending = false

  function wireState(): CollabAwarenessState | null {
    const user = local.user as { id?: string; name?: string; color?: string } | undefined
    if (!user) return null
    const id = user.id ?? `client-${clientID}`
    const caretLocal = local.cursor as { anchor: unknown; head: unknown } | null | undefined
    const { cursor: _cursor, user: _user, ...rest } = local
    return {
      ...rest,
      user: {
        ...user,
        id,
        name: user.name ?? 'Anonymous',
        color: toHexColor(user.color ?? generateUserColor(id))
      },
      clientId: clientID,
      cursor: null,
      caret: caretLocal
        ? { anchor: toRelJSON(caretLocal.anchor), head: toRelJSON(caretLocal.head) }
        : null
    }
  }

  function flush(): void {
    pending = false
    const state = wireState()
    if (state) send(state)
  }

  function schedule(): void {
    if (pending) return
    pending = true
    queueMicrotask(flush)
  }

  return {
    clientID,

    getLocalState() {
      return Object.keys(local).length === 0 ? null : local
    },

    setLocalStateField(field, value) {
      local[field] = value
      schedule()
    },

    getStates() {
      return states
    },

    on(event, callback) {
      if (event === 'change') listeners.push(callback)
    },

    off(event, callback) {
      if (event !== 'change') return
      const i = listeners.indexOf(callback)
      if (i !== -1) listeners.splice(i, 1)
    },

    receive(users) {
      const next = new Map<number, Record<string, unknown>>()
      for (const state of users ?? []) {
        const id = state?.clientId
        if (typeof id !== 'number') continue // not an editor peer (crouton-flow, scripts)
        const user = state.user ?? ({} as CollabAwarenessState['user'])
        next.set(id, {
          ...state,
          user: { ...user, color: toHexColor(user.color ?? generateUserColor(String(user.id ?? id))) },
          cursor: state.caret ?? null
        })
      }
      states = next
      for (const cb of [...listeners]) cb()
    },

    resend() {
      flush()
    },

    setEditorSelection({ focused, fragment, state }) {
      if (!focused) return
      const { anchor, head, from, to, $anchor } = state.selection
      const index = $anchor.index(0)
      local.fragment = rootNameOf(fragment)
      local.selection = { anchor, head }
      local.block = index < state.doc.childCount
        ? { index, type: state.doc.child(index).type.name }
        : null
      local.text = from === to
        ? null
        : state.doc.textBetween(from, to, ' ').slice(0, MAX_SHARED_TEXT)
      schedule()
    }
  }
}
