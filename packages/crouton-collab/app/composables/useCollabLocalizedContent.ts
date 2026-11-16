import * as Y from 'yjs'
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useCollabConnection, type UseCollabConnectionReturn } from './useCollabConnection'
import type { CollabAwarenessState } from '../types/collab'

export interface UseCollabLocalizedContentOptions {
  /** Unique room identifier (e.g., 'page-123'). Can be null to skip connection. */
  roomId: string | null
  /** Room type (default: 'page') */
  roomType?: string
  /** Field name prefix for locale fragments (default: 'content') */
  fieldPrefix?: string
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean
  /** User info for presence */
  user?: { name: string; color?: string }
}

export interface LocaleXmlFragment {
  locale: string
  fragment: Y.XmlFragment
}

export interface UseCollabLocalizedContentReturn {
  // Connection state
  connected: ComputedRef<boolean>
  synced: ComputedRef<boolean>
  error: ComputedRef<Error | null>

  // Raw Yjs access
  ydoc: Y.Doc

  // Users in room
  users: Ref<CollabAwarenessState[]>

  // Connection for TipTap provider compatibility
  connection: UseCollabConnectionReturn

  /**
   * Get or create Y.XmlFragment for a specific locale
   * Creates fragment on first access, returns existing on subsequent calls
   *
   * @example
   * ```ts
   * const enFragment = getXmlFragment('en')
   * const nlFragment = getXmlFragment('nl')
   * // Both fragments are in the same Y.Doc, synced through same WebSocket
   * ```
   */
  getXmlFragment: (locale: string) => Y.XmlFragment

  /**
   * Get all locale fragments that have been created
   */
  getActiveFragments: () => LocaleXmlFragment[]

  /**
   * Get content from a locale's fragment as JSON
   * Useful for persisting to database
   */
  getContentJson: (locale: string) => unknown

  /**
   * Set content for a locale from JSON
   * Only sets content if the fragment is empty (no existing collaborative edits)
   * Use force=true to overwrite even if content exists (e.g., for AI translation)
   */
  setContentJson: (locale: string, content: unknown, force?: boolean) => void

  /**
   * Check if a locale's fragment has any content
   * Useful for determining if collaborative edits exist before overwriting
   */
  hasContent: (locale: string) => boolean

  // Actions
  connect: () => void
  disconnect: () => void
}

/**
 * Composable for collaborative editing of localized content
 *
 * Creates a single Yjs room with multiple Y.XmlFragments, one per locale.
 * All locales share the same WebSocket connection and sync together.
 * Users editing any locale appear in the same room for presence.
 *
 * @example
 * ```ts
 * const {
 *   getXmlFragment,
 *   connected,
 *   users
 * } = useCollabLocalizedContent({
 *   roomId: 'page-123',
 *   user: { name: 'Alice' }
 * })
 *
 * // In CroutonI18nInput or block editor:
 * const currentLocale = ref('en')
 * const fragment = computed(() => getXmlFragment(currentLocale.value))
 *
 * // TipTap binds to fragment.value
 * // When switching locales, it rebinds to the new fragment
 * ```
 */
export function useCollabLocalizedContent(
  options: UseCollabLocalizedContentOptions
): UseCollabLocalizedContentReturn {
  const {
    roomId,
    roomType = 'page',
    fieldPrefix = 'content',
    autoConnect = true
  } = options

  // Get the low-level connection (creates Y.Doc and WebSocket)
  const connection = useCollabConnection({
    roomId,
    roomType,
    autoConnect
  })

  const { ydoc, connected, synced, error, connect, disconnect } = connection

  // Track created fragments
  const fragmentsByLocale = new Map<string, Y.XmlFragment>()

  // Users in room
  const users = ref<CollabAwarenessState[]>([])

  // Listen for awareness updates
  connection.onAwareness((updatedUsers) => {
    users.value = updatedUsers
  })

  /**
   * Get or create Y.XmlFragment for a locale
   * Fragment name is `${fieldPrefix}-${locale}` (e.g., 'content-en', 'content-nl')
   */
  function getXmlFragment(locale: string): Y.XmlFragment {
    if (fragmentsByLocale.has(locale)) {
      return fragmentsByLocale.get(locale)!
    }

    // Create new fragment for this locale
    const fragmentName = `${fieldPrefix}-${locale}`
    const fragment = ydoc.getXmlFragment(fragmentName)
    fragmentsByLocale.set(locale, fragment)

    return fragment
  }

  /**
   * Get all active locale fragments
   */
  function getActiveFragments(): LocaleXmlFragment[] {
    const result: LocaleXmlFragment[] = []
    fragmentsByLocale.forEach((fragment, locale) => {
      result.push({ locale, fragment })
    })
    return result
  }

  /**
   * Get content from a locale's fragment as JSON
   * Uses TipTap's JSON export format
   */
  function getContentJson(locale: string): unknown {
    const fragment = getXmlFragment(locale)
    // Convert Y.XmlFragment to JSON
    // This produces a structure compatible with TipTap
    return yXmlFragmentToJson(fragment)
  }

  /**
   * Check if a locale's fragment has any meaningful content
   * Returns true if there are any elements in the fragment
   */
  function hasContent(locale: string): boolean {
    const fragment = getXmlFragment(locale)
    // Check if fragment has any children
    if (fragment.length === 0) return false

    // Check if it's just an empty paragraph (TipTap default)
    if (fragment.length === 1) {
      const firstItem = fragment.get(0)
      if (firstItem instanceof Y.XmlElement) {
        // Empty paragraph has no children
        if (firstItem.nodeName === 'paragraph' && firstItem.length === 0) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Set content for a locale from JSON
   * Only sets content if the fragment is empty (no existing collaborative edits)
   * Use force=true to overwrite even if content exists (e.g., for AI translation)
   */
  function setContentJson(locale: string, content: unknown, force = false): void {
    const fragment = getXmlFragment(locale)

    // Skip if fragment already has content from other collaborators
    // unless force=true (used for AI translation which should overwrite)
    if (!force && hasContent(locale)) {
      return
    }

    // Clear existing content
    fragment.delete(0, fragment.length)

    // Convert JSON to Y.XmlFragment content
    if (content && typeof content === 'object') {
      jsonToYXmlFragment(content, fragment)
    }
  }

  return {
    // Connection state
    connected,
    synced,
    error,

    // Raw Yjs access
    ydoc,

    // Users
    users,

    // Connection
    connection,

    // Locale fragment access
    getXmlFragment,
    getActiveFragments,
    getContentJson,
    setContentJson,
    hasContent,

    // Actions
    connect,
    disconnect
  }
}

// ---------------------------------------------------------------------------
// JSON <-> Y.XmlFragment, lossless and in y-prosemirror's encoding (what TipTap's
// Collaboration extension reads/writes), so content survives the round trip:
// - node attrs keep their real values (arrays/objects/numbers, not String(value))
// - text marks are XmlText formatting attributes: { [markType]: markAttrs }
// - adjacent text nodes share one XmlText (one delta per text node)
// Before this, marks (bold/italic/links) were dropped and array attrs became
// "[object Object]", so saving a page from the editor stripped its formatting.
// ---------------------------------------------------------------------------

type JsonMark = { type: string; attrs?: Record<string, unknown> }
type JsonNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: JsonNode[]; marks?: JsonMark[] }

function marksToAttributes(marks: JsonMark[] | undefined): Record<string, unknown> | undefined {
  if (!marks?.length) return undefined
  const out: Record<string, unknown> = {}
  for (const m of marks) out[m.type] = m.attrs ?? {}
  return out
}

function attributesToMarks(attributes: Record<string, unknown> | undefined): JsonMark[] | undefined {
  if (!attributes) return undefined
  const marks = Object.entries(attributes)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([type, v]) => (v && typeof v === 'object' && Object.keys(v as object).length
      ? { type, attrs: v as Record<string, unknown> }
      : { type }))
  return marks.length ? marks : undefined
}

function xmlTextToJson(text: Y.XmlText): JsonNode[] {
  const out: JsonNode[] = []
  for (const op of text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof op.insert !== 'string' || !op.insert) continue
    const node: JsonNode = { type: 'text', text: op.insert }
    const marks = attributesToMarks(op.attributes)
    if (marks) node.marks = marks
    out.push(node)
  }
  return out
}

function childrenToJson(parent: Y.XmlFragment | Y.XmlElement): JsonNode[] {
  const content: JsonNode[] = []
  for (let i = 0; i < parent.length; i++) {
    const child = parent.get(i)
    if (child instanceof Y.XmlElement) content.push(yXmlElementToJson(child))
    else if (child instanceof Y.XmlText) content.push(...xmlTextToJson(child))
  }
  return content
}

/** Convert Y.XmlFragment to JSON (TipTap compatible) */
function yXmlFragmentToJson(fragment: Y.XmlFragment): unknown {
  return { type: 'doc', content: childrenToJson(fragment) }
}

/** Convert Y.XmlElement to JSON */
function yXmlElementToJson(element: Y.XmlElement): JsonNode {
  const result: JsonNode = { type: element.nodeName }
  const attrs = element.getAttributes() as Record<string, unknown>
  if (Object.keys(attrs).length > 0) result.attrs = attrs
  const content = childrenToJson(element)
  if (content.length > 0) result.content = content
  return result
}

/** Build Yjs children for a list of JSON nodes (adjacent text → one XmlText) */
// fallow-ignore-next-line complexity -- the y-prosemirror encoding (text runs vs elements, attr values) is clearest as one walk
function jsonChildrenToY(nodes: JsonNode[] | undefined): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = []
  let pendingText: JsonNode[] = []
  const flushText = () => {
    if (!pendingText.length) return
    const text = new Y.XmlText()
    // insert() on a not-yet-integrated XmlText is queued by Yjs until it is pushed
    // (applyDelta would read the detached type and warn)
    let offset = 0
    for (const n of pendingText) {
      // Explicit nulls stop a run inheriting the previous run's marks
      const attributes = marksToAttributes(n.marks) ?? {}
      text.insert(offset, n.text!, attributes)
      offset += n.text!.length
    }
    out.push(text)
    pendingText = []
  }
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue
    if (node.type === 'text' && typeof node.text === 'string') {
      if (node.text) pendingText.push(node)
      continue
    }
    flushText()
    const el = jsonToYXmlElement(node)
    if (el) out.push(el)
  }
  flushText()
  return out
}

/** Convert JSON to Y.XmlFragment content */
function jsonToYXmlFragment(json: unknown, fragment: Y.XmlFragment): void {
  if (!json || typeof json !== 'object') return
  const doc = json as JsonNode
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return
  const children = jsonChildrenToY(doc.content)
  if (children.length) fragment.push(children)
}

/** Convert a JSON element node to Y.XmlElement */
// fallow-ignore-next-line complexity -- the y-prosemirror encoding (text runs vs elements, attr values) is clearest as one walk
function jsonToYXmlElement(node: JsonNode): Y.XmlElement | null {
  if (!node.type || node.type === 'text') return null
  const element = new Y.XmlElement(node.type)
  for (const [key, value] of Object.entries(node.attrs || {})) {
    // Real values, as y-prosemirror stores them (null attrs are omitted like prosemirror defaults)
    if (value !== null && value !== undefined) element.setAttribute(key, value as any)
  }
  const children = jsonChildrenToY(node.content)
  if (children.length) element.insert(0, children) // insert, not push: push reads .length of the detached type (Yjs warns)
  return element
}
