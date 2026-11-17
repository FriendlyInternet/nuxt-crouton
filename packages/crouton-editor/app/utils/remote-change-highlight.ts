/**
 * Remote change highlight (collab only).
 *
 * When a collaborator (another window, another person, an agent) changes the
 * shared document, the blocks they ADD slide in and glow briefly, and the
 * blocks they REMOVE fade out as a short-lived "ghost" instead of vanishing.
 *
 * The ghost is created ONCE, outside ProseMirror's DOM (an absolutely
 * positioned copy laid over the spot the block occupied), and then left alone:
 * one CSS opacity animation run by the browser, removed on `animationend`.
 * It is deliberately not a widget decoration — y-sync rewrites the doc on every
 * remote transaction, and re-placing a widget re-inserts its DOM, which
 * restarts the animation and makes the fade go in visible steps.
 * With `prefers-reduced-motion: reduce` there is no ghost: the block just goes.
 *
 * Local typing, local inserts/deletes, local undo/redo and the first fill of
 * the editor never animate.
 *
 * "New" is judged by the top-level **Yjs element**, not the ProseMirror node:
 * y-tiptap re-creates the ProseMirror node of every block whose text changed,
 * so node identity would make a block glow on every remote keystroke inside it.
 * Yjs elements keep their identity while their content is edited.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
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
  | { skip: false, added: T[], removed: T[] }

/**
 * Pure decision: given the y-sync meta of a transaction and the top-level Yjs
 * elements before/after it, which blocks did a remote change add or remove?
 */
export function classifyRemoteChange<T>(
  meta: YSyncMeta | null | undefined,
  prevTypes: readonly T[] | ReadonlySet<T> | null | undefined,
  nowTypes: readonly T[]
): RemoteChangeDecision<T> {
  if (!meta || !meta.isChangeOrigin) return { skip: true }
  // Force-rerender (first fill / re-bind) carries the binding.
  if (meta.binding) return { skip: true }
  // Local undo/redo is applied through y-sync too — never animate it.
  if (meta.isUndoRedoOperation) return { skip: true }
  if (!prevTypes) return { skip: true }
  const prevSet: ReadonlySet<T> = prevTypes instanceof Set ? prevTypes : new Set(prevTypes as readonly T[])
  // An empty Yjs fragment means the editor only showed its placeholder empty
  // paragraph; the first remote content replaces it rather than adding a block.
  if (prevSet.size === 0) return { skip: true }

  const nowSet = new Set(nowTypes)
  const added = nowTypes.filter(t => !prevSet.has(t))
  const removed = [...prevSet].filter(t => !nowSet.has(t))
  return { skip: false, added, removed }
}

export interface RemoteChangePluginOptions {
  /** How long the "new" class stays on an added block (ms). Default 2400. */
  glowMs?: number
  /**
   * Safety net only (ms): remove a ghost whose `animationend` never fires
   * (CSS not loaded, tab hidden). Never drives the fade. Default 1500.
   */
  ghostFallbackMs?: number
}

/** A removed block's copy + where it was on screen, captured before the DOM changed. */
interface PendingGhost {
  clone: HTMLElement
  rect: { top: number, left: number, width: number, height: number }
}

interface Binding {
  type: { toArray: () => unknown[] }
  mapping: Map<unknown, PMNode | PMNode[]>
}

interface PluginMeta {
  dropGlow?: unknown[]
}

const remoteChangeHighlightKey = new PluginKey<DecorationSet>('crouton-remote-change')

function getBinding(state: EditorState): Binding | null {
  const sync = ySyncPluginKey.getState(state) as { binding?: Binding } | undefined
  return sync?.binding ?? null
}

/** Top-level positions of the doc's children, by node identity. */
function topLevelPositions(doc: PMNode): Map<PMNode, number> {
  const out = new Map<PMNode, number>()
  doc.forEach((node, offset) => { out.set(node, offset) })
  return out
}

function nodeFor(binding: Binding, yEl: unknown): PMNode | null {
  const n = binding.mapping.get(yEl)
  if (!n) return null
  return Array.isArray(n) ? (n[0] ?? null) : n
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Nearest positioned ancestor (the containing block of an absolute child), or null for the page. */
function positionedAncestor(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (getComputedStyle(p).position !== 'static') return p
  }
  return null
}

/**
 * Lay the ghost over the spot the removed block occupied and let CSS fade it.
 * Appended next to the editor (outside its contenteditable), so ProseMirror
 * never sees, moves or re-renders it.
 */
function mountGhost(view: EditorView, g: PendingGhost, fallbackMs: number, live: Set<HTMLElement>) {
  const editorDom = view.dom as HTMLElement
  const host = positionedAncestor(editorDom)
  const parent = editorDom.parentElement ?? document.body
  let top = g.rect.top + window.scrollY
  let left = g.rect.left + window.scrollX
  if (host) {
    const h = host.getBoundingClientRect()
    top = g.rect.top - h.top + host.scrollTop - host.clientTop
    left = g.rect.left - h.left + host.scrollLeft - host.clientLeft
  }

  // The wrapper carries the editor's classes so the copy keeps its typography.
  const ghost = document.createElement('div')
  ghost.className = `${editorDom.className} crouton-remote-gone`.trim()
  ghost.setAttribute('aria-hidden', 'true')
  ghost.setAttribute('contenteditable', 'false')
  Object.assign(ghost.style, {
    position: 'absolute',
    top: `${top}px`,
    left: `${left}px`,
    width: `${g.rect.width}px`,
    height: `${g.rect.height}px`,
    margin: '0',
    padding: '0',
    border: '0',
    minHeight: '0',
    outline: 'none'
  })
  g.clone.style.margin = '0'
  ghost.appendChild(g.clone)

  let fallback: ReturnType<typeof setTimeout> | undefined
  const remove = () => {
    if (fallback !== undefined) clearTimeout(fallback)
    live.delete(ghost)
    ghost.remove()
  }
  ghost.addEventListener('animationend', remove, { once: true })
  ghost.addEventListener('animationcancel', remove, { once: true })
  fallback = setTimeout(remove, fallbackMs)
  live.add(ghost)
  parent.appendChild(ghost)
}

export function createRemoteChangePlugin(opts: RemoteChangePluginOptions = {}): Plugin<DecorationSet> {
  const glowMs = opts.glowMs ?? 2400
  const ghostFallbackMs = opts.ghostFallbackMs ?? 1500

  // Shared between apply() and the plugin view (one plugin instance per editor).
  let prevTypes: unknown[] | null = null
  const lastDom = new Map<unknown, HTMLElement>()
  const glowing = new Set<unknown>()
  // Filled in apply() — while the removed block is still on screen — mounted in view.update().
  let pendingGhosts: PendingGhost[] = []
  let pendingGlow: unknown[] = []

  function rebuild(doc: PMNode, binding: Binding): DecorationSet {
    const positions = topLevelPositions(doc)
    const posOf = (yEl: unknown): number | null => {
      const node = nodeFor(binding, yEl)
      if (!node) return null
      const pos = positions.get(node)
      return pos === undefined ? null : pos
    }
    const decos: Decoration[] = []
    for (const yEl of glowing) {
      const pos = posOf(yEl)
      if (pos === null) continue
      const node = doc.nodeAt(pos)
      if (!node) continue
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'crouton-remote-new' }, { remoteNew: true }))
    }
    return DecorationSet.create(doc, decos)
  }

  function refreshFrom(binding: Binding, view?: EditorView) {
    const types = binding.type.toArray()
    prevTypes = types
    if (!view) return
    const positions = topLevelPositions(view.state.doc)
    const seen = new Set<unknown>()
    for (const yEl of types) {
      seen.add(yEl)
      const node = nodeFor(binding, yEl)
      if (!node) continue
      const pos = positions.get(node)
      if (pos === undefined) continue
      const dom = view.nodeDOM(pos)
      if (dom && (dom as HTMLElement).nodeType === 1) lastDom.set(yEl, dom as HTMLElement)
    }
    for (const k of [...lastDom.keys()]) if (!seen.has(k)) lastDom.delete(k)
  }

  /** A timer fired: forget the glows it was scheduled for. */
  function applyDrop(own: PluginMeta, tr: Transaction, decos: DecorationSet, oldState: EditorState, newState: EditorState): DecorationSet {
    for (const yEl of own.dropGlow ?? []) glowing.delete(yEl)
    const binding = getBinding(newState) ?? getBinding(oldState)
    return binding ? rebuild(tr.doc, binding) : decos.map(tr.mapping, tr.doc)
  }

  function markAdded(added: readonly unknown[]) {
    for (const yEl of added) {
      glowing.add(yEl)
      pendingGlow.push(yEl)
    }
  }

  /** Runs in apply(), before the view drops the block — so its DOM can still be measured. */
  function addGhosts(removed: readonly unknown[]) {
    if (!removed.length || prefersReducedMotion()) return
    for (const yEl of removed) {
      const src = lastDom.get(yEl)
      if (!src || !src.isConnected) continue
      const r = src.getBoundingClientRect()
      pendingGhosts.push({
        clone: src.cloneNode(true) as HTMLElement,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height }
      })
    }
  }

  /** A y-sync transaction that changed the doc: record what a remote change added/removed. */
  function applySync(meta: YSyncMeta, binding: Binding, doc: PMNode): DecorationSet {
    if (meta.binding) {
      // First fill / re-bind: start fresh, animate nothing.
      glowing.clear()
      pendingGhosts = []
      prevTypes = (meta.binding as Binding).type.toArray()
      return DecorationSet.empty
    }

    const nowTypes = binding.type.toArray()
    const decision = classifyRemoteChange(meta, prevTypes, nowTypes)
    if (!decision.skip) {
      markAdded(decision.added)
      addGhosts(decision.removed)
    }
    prevTypes = nowTypes
    // y-sync replaces the whole doc range, so mapping would drop everything — rebuild.
    return rebuild(doc, binding)
  }

  return new Plugin<DecorationSet>({
    key: remoteChangeHighlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr: Transaction, decos: DecorationSet, oldState: EditorState, newState: EditorState) {
        const own = tr.getMeta(remoteChangeHighlightKey) as PluginMeta | undefined
        if (own?.dropGlow) return applyDrop(own, tr, decos, oldState, newState)

        const meta = tr.getMeta(ySyncPluginKey) as YSyncMeta | undefined
        if (!meta || !meta.isChangeOrigin) return decos.map(tr.mapping, tr.doc)

        const binding = getBinding(newState) ?? getBinding(oldState)
        if (!binding) return decos.map(tr.mapping, tr.doc)

        return applySync(meta, binding, tr.doc)
      }
    },
    props: {
      decorations(state) {
        return remoteChangeHighlightKey.getState(state)
      }
    },
    view(view) {
      const timers = new Set<ReturnType<typeof setTimeout>>()
      const liveGhosts = new Set<HTMLElement>()
      const schedule = (ms: number, meta: PluginMeta) => {
        const t = setTimeout(() => {
          timers.delete(t)
          if ((view as any).isDestroyed) return
          view.dispatch(view.state.tr.setMeta(remoteChangeHighlightKey, meta))
        }, ms)
        timers.add(t)
      }
      const flush = () => {
        if (pendingGhosts.length) {
          for (const g of pendingGhosts) mountGhost(view, g, ghostFallbackMs, liveGhosts)
          pendingGhosts = []
        }
        if (pendingGlow.length) {
          schedule(glowMs, { dropGlow: pendingGlow })
          pendingGlow = []
        }
      }
      const initial = getBinding(view.state)
      if (initial) refreshFrom(initial, view)
      return {
        update(v) {
          const binding = getBinding(v.state)
          // After y-sync's own view update, the Yjs fragment reflects local edits too,
          // so a local insert/delete is already "known" before any remote change.
          if (binding) refreshFrom(binding, v)
          flush()
        },
        destroy() {
          for (const t of timers) clearTimeout(t)
          timers.clear()
          for (const g of [...liveGhosts]) g.dispatchEvent(new Event('animationcancel'))
          liveGhosts.clear()
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
