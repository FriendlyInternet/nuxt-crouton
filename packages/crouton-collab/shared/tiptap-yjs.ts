/**
 * TipTap JSON ⇄ Yjs XmlFragment converter (#3982).
 *
 * Shared by the browser (`useCollabLocalizedContent`) and the app server
 * (`collabServerDoc`, the MCP pages tools), so a page seeded or edited on either
 * side produces the same Yjs structure. Pure: depends on `yjs` only.
 *
 * Encoding matches y-prosemirror (what TipTap's Collaboration extension reads):
 * - node attributes are stored RAW (objects and numbers kept — never `String()`),
 * - a node's consecutive text children share ONE `Y.XmlText`, whose formatting
 *   attributes are the marks: `{ [mark.type]: mark.attrs ?? {} }`,
 * - inline element nodes (e.g. `hardBreak`) are their own `Y.XmlElement`.
 */
import * as Y from 'yjs'

export interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

export interface TiptapDoc {
  type: 'doc'
  content: TiptapNode[]
}

// ─── TipTap → Yjs ───────────────────────────────────────────────────────────

function isTextNode(node: unknown): node is TiptapNode & { text: string } {
  return !!node && typeof node === 'object'
    && (node as TiptapNode).type === 'text'
    && typeof (node as TiptapNode).text === 'string'
}

function marksToAttributes(marks: TiptapMark[] | undefined): Record<string, unknown> | undefined {
  if (!Array.isArray(marks) || marks.length === 0) return undefined
  return Object.fromEntries(marks.filter(m => m && typeof m.type === 'string').map(m => [m.type, m.attrs ?? {}]))
}

/** A run of consecutive text nodes → one XmlText carrying the marks as formatting. */
function textRunToYText(run: Array<TiptapNode & { text: string }>): Y.XmlText {
  const delta = run
    .filter(n => n.text.length > 0)
    .map((n) => {
      const attributes = marksToAttributes(n.marks)
      return attributes ? { insert: n.text, attributes } : { insert: n.text }
    })
  const text = new Y.XmlText()
  if (delta.length > 0) text.applyDelta(delta)
  return text
}

/** Convert a list of sibling TipTap nodes to Yjs items (text runs merged). */
function nodesToYItems(nodes: unknown[]): Array<Y.XmlElement | Y.XmlText> {
  const out: Array<Y.XmlElement | Y.XmlText> = []
  let run: Array<TiptapNode & { text: string }> = []
  const flush = () => {
    if (run.length > 0) out.push(textRunToYText(run))
    run = []
  }
  for (const node of nodes) {
    if (isTextNode(node)) {
      run.push(node)
      continue
    }
    flush()
    const element = tiptapNodeToYElement(node)
    if (element) out.push(element)
  }
  flush()
  return out
}

/** True for a TipTap element node (an object with a string type that is not `text` / `doc`). */
export function isTiptapElementNode(node: unknown): node is TiptapNode {
  const type = (node as TiptapNode | null)?.type
  return !!node && typeof node === 'object' && !Array.isArray(node)
    && typeof type === 'string' && type !== '' && type !== 'text' && type !== 'doc'
}

function setRawAttributes(element: Y.XmlElement, attrs: Record<string, unknown> | undefined): void {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    // Raw value: Yjs stores any JSON value, and `String()` turns objects into "[object Object]"
    if (value !== null && value !== undefined) element.setAttribute(key, value as string)
  }
}

/** One TipTap element node → `Y.XmlElement` (null for anything that is not a node). */
export function tiptapNodeToYElement(node: unknown): Y.XmlElement | null {
  if (!isTiptapElementNode(node)) return null
  const element = new Y.XmlElement(node.type)
  setRawAttributes(element, node.attrs)
  const items = Array.isArray(node.content) ? nodesToYItems(node.content) : []
  if (items.length > 0) element.insert(0, items)
  return element
}

/** Append a TipTap `doc` to a fragment. Non-doc input is ignored. */
export function tiptapToYFragment(json: unknown, fragment: Y.XmlFragment): void {
  if (!json || typeof json !== 'object') return
  const doc = json as { type?: string, content?: unknown[] }
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return
  const items = nodesToYItems(doc.content)
  if (items.length > 0) fragment.insert(fragment.length, items)
}

// ─── Yjs → TipTap ───────────────────────────────────────────────────────────

function yTextToTiptap(text: Y.XmlText): TiptapNode[] {
  const out: TiptapNode[] = []
  for (const op of text.toDelta() as Array<{ insert?: unknown, attributes?: Record<string, unknown> }>) {
    if (typeof op.insert !== 'string' || op.insert.length === 0) continue
    const node: TiptapNode = { type: 'text', text: op.insert }
    if (op.attributes && Object.keys(op.attributes).length > 0) {
      node.marks = Object.entries(op.attributes).map(([type, attrs]) => {
        const mark: TiptapMark = { type }
        if (attrs && typeof attrs === 'object' && Object.keys(attrs as object).length > 0) {
          mark.attrs = attrs as Record<string, unknown>
        }
        return mark
      })
    }
    out.push(node)
  }
  return out
}

/** One `Y.XmlElement` → TipTap node. */
export function yElementToTiptap(element: Y.XmlElement): TiptapNode {
  const result: TiptapNode = { type: element.nodeName }
  const attrs = element.getAttributes() as Record<string, unknown>
  if (Object.keys(attrs).length > 0) result.attrs = attrs

  const content: TiptapNode[] = []
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlElement) content.push(yElementToTiptap(child))
    else if (child instanceof Y.XmlText) content.push(...yTextToTiptap(child))
  }
  if (content.length > 0) result.content = content
  return result
}

/** A fragment → TipTap `doc`. */
export function yFragmentToTiptap(fragment: Y.XmlFragment): TiptapDoc {
  const content: TiptapNode[] = []
  for (const item of fragment.toArray()) {
    if (item instanceof Y.XmlElement) content.push(yElementToTiptap(item))
    else if (item instanceof Y.XmlText) content.push(...yTextToTiptap(item))
  }
  return { type: 'doc', content }
}

// ─── Seeding ────────────────────────────────────────────────────────────────

/** Stable 32-bit FNV-1a hash used as a deterministic Yjs clientID (≥ 1). */
export function seedClientId(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) || 1
}

/**
 * True when the fragment holds real content. Empty, or a single empty paragraph
 * (TipTap's default), counts as empty.
 */
export function hasFragmentContent(fragment: Y.XmlFragment): boolean {
  if (fragment.length === 0) return false
  if (fragment.length === 1) {
    const first = fragment.get(0)
    if (first instanceof Y.XmlElement && first.nodeName === 'paragraph' && first.length === 0) {
      return false
    }
  }
  return true
}

/**
 * Fill `fragmentName` in `ydoc` with `content`, built in a throwaway doc whose
 * clientID is derived from the content. Two seeds of the same page (two browser
 * windows, or a window and the MCP tools) then produce identical Yjs structs and
 * merge into ONE copy (#3983). The caller decides whether the fragment is empty.
 */
export function seedYFragment(ydoc: Y.Doc, fragmentName: string, content: unknown): void {
  if (!content || typeof content !== 'object') return
  const seedDoc = new Y.Doc()
  seedDoc.clientID = seedClientId(fragmentName + JSON.stringify(content))
  tiptapToYFragment(content, seedDoc.getXmlFragment(fragmentName))
  // Origin 'seed' (not 'remote') so a browser connection still sends it upstream
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seedDoc), 'seed')
  seedDoc.destroy()
}

// ─── Block edits ────────────────────────────────────────────────────────────

export interface FragmentEditOp {
  action: 'insert' | 'replace' | 'delete'
  /** Top-level block index the edit starts at. */
  index: number
  /** Blocks to remove (replace: default `blocks.length`; delete: default 1). */
  count?: number
  /** TipTap block nodes to insert (insert / replace). */
  blocks?: unknown[]
}

/**
 * Apply one block-level edit to a fragment. `insert` puts `blocks` before
 * `index` (`index === length` appends); `replace` removes `count ?? blocks.length`
 * from `index` and inserts `blocks` there; `delete` removes `count ?? 1`.
 * An out-of-range index or count throws `RangeError`. Run inside a transaction
 * to emit one update.
 */
export function editYFragment(fragment: Y.XmlFragment, op: FragmentEditOp): void {
  const handler = EDIT_ACTIONS[op.action]
  if (!handler) throw new TypeError(`unknown action ${String(op.action)}`)
  handler(fragment, op)
}

function toElements(blocks: unknown[] | undefined, required: boolean): Y.XmlElement[] {
  const elements = (blocks ?? []).map((block, i) => {
    const el = tiptapNodeToYElement(block)
    if (!el) throw new TypeError(`block ${i} is not a TipTap node with a string type`)
    return el
  })
  if (required && elements.length === 0) throw new TypeError('needs at least one block')
  return elements
}

/** `index` must be an integer in [0, max]. */
function assertIndex(index: number, max: number): void {
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new RangeError(`index ${index} is out of range (0–${max})`)
  }
}

/** The span [index, index + count) must lie inside the fragment. */
function assertSpan(fragment: Y.XmlFragment, index: number, count: number): void {
  assertIndex(index, fragment.length - 1)
  if (!Number.isInteger(count) || count < 1 || index + count > fragment.length) {
    throw new RangeError(`count ${count} at index ${index} is out of range (length ${fragment.length})`)
  }
}

const EDIT_ACTIONS: Record<FragmentEditOp['action'], (fragment: Y.XmlFragment, op: FragmentEditOp) => void> = {
  insert(fragment, op) {
    assertIndex(op.index, fragment.length)
    fragment.insert(op.index, toElements(op.blocks, true))
  },
  replace(fragment, op) {
    const elements = toElements(op.blocks, true)
    const count = op.count ?? elements.length
    assertSpan(fragment, op.index, count)
    fragment.delete(op.index, count)
    fragment.insert(op.index, elements)
  },
  delete(fragment, op) {
    const count = op.count ?? 1
    assertSpan(fragment, op.index, count)
    fragment.delete(op.index, count)
  }
}
