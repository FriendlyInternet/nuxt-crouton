/**
 * Remote change highlight (collab only).
 *
 * When a collaborator (another window, another person, an agent) ADDS a block
 * to the shared document, that block gets a thin line on its left for about
 * two seconds, then the line fades away. Removed blocks simply go — no
 * animation. The line and its fade are pure CSS (see Blocks.vue); this plugin
 * only puts the class on the block and switches it from "new" to "fading".
 *
 * Local typing, local inserts/deletes, local undo/redo and the first fill of
 * the editor never mark anything.
 *
 * "New" is judged by the top-level **Yjs element**, not the ProseMirror node:
 * y-tiptap re-creates the ProseMirror node of every block whose text changed,
 * so node identity would mark a block on every remote keystroke inside it.
 * Yjs elements keep their identity while their content is edited.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
// The real y-sync key (`y-sync$`) — the same instance the Collaboration
// extension registers. Never re-create it with `new PluginKey('y-sync')`:
// ProseMirror numbers repeated names, so that would be `y-sync$1`.
import { ySyncPluginKey } from '@tiptap/y-tiptap'

export interface YSyncMeta {
  isChangeOrigin?: boolean
  isUndoRedoOperation?: boolean
  binding?: unknown
  [key: string]: unknown
}

export type RemoteChangeDecision<T> =
  | { skip: true }
  | { skip: false, added: T[] }

/**
 * Pure decision: given the y-sync meta of a transaction and the top-level Yjs
 * elements before/after it, which blocks did a remote change add?
 */
export function classifyRemoteChange<T>(
  meta: YSyncMeta | null | undefined,
  prevTypes: readonly T[] | ReadonlySet<T> | null | undefined,
  nowTypes: readonly T[]
): RemoteChangeDecision<T> {
  if (!meta || !meta.isChangeOrigin) return { skip: true }
  // Force-rerender (first fill / re-bind) carries the binding.
  if (meta.binding) return { skip: true }
  // Local undo/redo is applied through y-sync too — never mark it.
  if (meta.isUndoRedoOperation) return { skip: true }
  if (!prevTypes) return { skip: true }
  const prevSet: ReadonlySet<T> = prevTypes instanceof Set ? prevTypes : new Set(prevTypes as readonly T[])
  // An empty Yjs fragment means the editor only showed its placeholder empty
  // paragraph; the first remote content replaces it rather than adding a block.
  if (prevSet.size === 0) return { skip: true }

  return { skip: false, added: nowTypes.filter(t => !prevSet.has(t)) }
}

export interface RemoteChangePluginOptions {
  /** How long the line stays fully visible on an added block (ms). Default 2000. */
  lineMs?: number
  /** How long the "fading" class stays before it is dropped — match the CSS transition (ms). Default 600. */
  fadeMs?: number
}

type Phase = 'new' | 'fading'

interface Binding {
  type: { toArray: () => unknown[] }
  mapping: Map<unknown, PMNode | PMNode[]>
}

interface PluginMeta {
  fade?: unknown[]
  drop?: unknown[]
}

const CLASS: Record<Phase, string> = {
  new: 'crouton-remote-new',
  fading: 'crouton-remote-new crouton-remote-fading'
}

const remoteChangeHighlightKey = new PluginKey<DecorationSet>('crouton-remote-change')

function getBinding(state: EditorState): Binding | null {
  const sync = ySyncPluginKey.getState(state) as { binding?: Binding } | undefined
  return sync?.binding ?? null
}

function nodeFor(binding: Binding, yEl: unknown): PMNode | null {
  const n = binding.mapping.get(yEl)
  if (!n) return null
  return Array.isArray(n) ? (n[0] ?? null) : n
}

export function createRemoteChangePlugin(opts: RemoteChangePluginOptions = {}): Plugin<DecorationSet> {
  const lineMs = opts.lineMs ?? 2000
  const fadeMs = opts.fadeMs ?? 600

  // Shared between apply() and the plugin view (one plugin instance per editor).
  let prevTypes: unknown[] | null = null
  const marked = new Map<unknown, Phase>()
  // Filled in apply(), scheduled in view.update().
  let pendingNew: unknown[] = []

  function rebuild(doc: PMNode, binding: Binding): DecorationSet {
    const positions = new Map<PMNode, number>()
    doc.forEach((node, offset) => { positions.set(node, offset) })
    const decos: Decoration[] = []
    for (const [yEl, phase] of marked) {
      const node = nodeFor(binding, yEl)
      const pos = node ? positions.get(node) : undefined
      if (!node || pos === undefined) continue
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: CLASS[phase] }))
    }
    return DecorationSet.create(doc, decos)
  }

  // Our own timer meta: advance phases (new → fading → gone).
  function applyOwnMeta(own: PluginMeta) {
    for (const yEl of own.fade ?? []) if (marked.has(yEl)) marked.set(yEl, 'fading')
    for (const yEl of own.drop ?? []) marked.delete(yEl)
  }

  // First fill / re-bind: start fresh, mark nothing.
  function resetForBinding(newBinding: Binding) {
    marked.clear()
    pendingNew = []
    prevTypes = newBinding.type.toArray()
  }

  function markRemoteAdditions(meta: YSyncMeta, binding: Binding) {
    const nowTypes = binding.type.toArray()
    const decision = classifyRemoteChange(meta, prevTypes, nowTypes)
    if (!decision.skip) {
      for (const yEl of decision.added) {
        marked.set(yEl, 'new')
        pendingNew.push(yEl)
      }
    }
    prevTypes = nowTypes
  }

  return new Plugin<DecorationSet>({
    key: remoteChangeHighlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr: Transaction, decos: DecorationSet, oldState: EditorState, newState: EditorState) {
        const binding = getBinding(newState) ?? getBinding(oldState)
        const own = tr.getMeta(remoteChangeHighlightKey) as PluginMeta | undefined
        if (own) {
          applyOwnMeta(own)
          return binding ? rebuild(tr.doc, binding) : decos.map(tr.mapping, tr.doc)
        }

        const meta = tr.getMeta(ySyncPluginKey) as YSyncMeta | undefined
        if (!meta || !meta.isChangeOrigin || !binding) return decos.map(tr.mapping, tr.doc)

        if (meta.binding) {
          resetForBinding(meta.binding as Binding)
          return DecorationSet.empty
        }

        markRemoteAdditions(meta, binding)
        // y-sync replaces the whole doc range, so mapping would drop everything — rebuild.
        return rebuild(tr.doc, binding)
      }
    },
    props: {
      decorations(state) {
        return remoteChangeHighlightKey.getState(state)
      }
    },
    view(view) {
      const timers = new Set<ReturnType<typeof setTimeout>>()
      const schedule = (ms: number, meta: PluginMeta) => {
        const t = setTimeout(() => {
          timers.delete(t)
          if ((view as any).isDestroyed) return
          view.dispatch(view.state.tr.setMeta(remoteChangeHighlightKey, meta))
        }, ms)
        timers.add(t)
      }
      const initial = getBinding(view.state)
      if (initial) prevTypes = initial.type.toArray()
      return {
        update(v) {
          // After y-sync's own view update, the Yjs fragment reflects local edits too,
          // so a local insert is already "known" before any remote change.
          const binding = getBinding(v.state)
          if (binding) prevTypes = binding.type.toArray()
          if (pendingNew.length) {
            const batch = pendingNew
            pendingNew = []
            schedule(lineMs, { fade: batch })
            schedule(lineMs + fadeMs, { drop: batch })
          }
        },
        destroy() {
          for (const t of timers) clearTimeout(t)
          timers.clear()
        }
      }
    }
  })
}

export const RemoteChangeHighlight = Extension.create({
  name: 'remoteChangeHighlight',
  addProseMirrorPlugins() {
    return [createRemoteChangePlugin()]
  }
})
