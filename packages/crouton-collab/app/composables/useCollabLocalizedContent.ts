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
   * Only sets content if the fragment is empty (no existing collaborative edits);
   * fills an empty fragment idempotently — concurrent fills with the same content
   * merge into one copy (#3983)
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
   * Only sets content if the fragment is empty (no existing collaborative edits);
   * fills an empty fragment idempotently — concurrent fills with the same content
   * merge into one copy (#3983)
   * Use force=true to overwrite even if content exists (e.g., for AI translation)
   */
  function setContentJson(locale: string, content: unknown, force = false): void {
    const fragment = getXmlFragment(locale)

    if (force) {
      // Explicit overwrite (AI translation, locale copy): replace with this
      // doc's own client ID.
      fragment.delete(0, fragment.length)
      if (content && typeof content === 'object') {
        jsonToYXmlFragment(content, fragment)
      }
      return
    }

    // Skip if fragment already has content from other collaborators
    if (hasContent(locale)) {
      return
    }

    // Drop TipTap's empty default paragraph, if any
    if (fragment.length > 0) {
      fragment.delete(0, fragment.length)
    }

    if (!content || typeof content !== 'object') return

    // Build the seed in a throwaway doc whose clientID is derived from the
    // content. Two windows filling an empty room with the same page then
    // produce identical Yjs structs (same client + clock), which Yjs merges
    // into one copy instead of keeping both (#3983). Different content gives
    // different IDs, so the docs still converge.
    const fragmentName = `${fieldPrefix}-${locale}`
    const seedDoc = new Y.Doc()
    seedDoc.clientID = seedClientId(fragmentName + JSON.stringify(content))
    jsonToYXmlFragment(content, seedDoc.getXmlFragment(fragmentName))
    // Origin 'seed' (not 'remote') so the connection still sends it upstream
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seedDoc), 'seed')
    seedDoc.destroy()
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

/**
 * Stable 32-bit FNV-1a hash used as a deterministic Yjs clientID (≥ 1)
 */
function seedClientId(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) || 1
}

/**
 * Convert Y.XmlFragment to JSON (TipTap compatible)
 */
function yXmlFragmentToJson(fragment: Y.XmlFragment): unknown {
  const content: unknown[] = []

  for (let i = 0; i < fragment.length; i++) {
    const item = fragment.get(i)
    if (item instanceof Y.XmlElement) {
      content.push(yXmlElementToJson(item))
    } else if (item instanceof Y.XmlText) {
      content.push({ type: 'text', text: item.toString() })
    }
  }

  return {
    type: 'doc',
    content
  }
}

/**
 * Convert Y.XmlElement to JSON
 */
function yXmlElementToJson(element: Y.XmlElement): unknown {
  const result: Record<string, unknown> = {
    type: element.nodeName
  }

  // Get attributes
  const attrs = element.getAttributes()
  if (Object.keys(attrs).length > 0) {
    result.attrs = attrs
  }

  // Get children
  const content: unknown[] = []
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i)
    if (child instanceof Y.XmlElement) {
      content.push(yXmlElementToJson(child))
    } else if (child instanceof Y.XmlText) {
      const text = child.toString()
      if (text) {
        content.push({ type: 'text', text })
      }
    }
  }

  if (content.length > 0) {
    result.content = content
  }

  return result
}

/**
 * Convert JSON to Y.XmlFragment content
 */
function jsonToYXmlFragment(json: unknown, fragment: Y.XmlFragment): void {
  if (!json || typeof json !== 'object') return

  const doc = json as { type?: string; content?: unknown[] }
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return

  for (const node of doc.content) {
    const element = jsonToYXmlElement(node)
    if (element) {
      fragment.push([element])
    }
  }
}

/**
 * Convert JSON node to Y.XmlElement
 */
function jsonToYXmlElement(node: unknown): Y.XmlElement | Y.XmlText | null {
  if (!node || typeof node !== 'object') return null

  const nodeObj = node as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] }

  // Text node
  if (nodeObj.type === 'text' && typeof nodeObj.text === 'string') {
    const text = new Y.XmlText()
    text.insert(0, nodeObj.text)
    return text
  }

  // Element node
  if (nodeObj.type) {
    const element = new Y.XmlElement(nodeObj.type)

    // Set attributes
    if (nodeObj.attrs) {
      for (const [key, value] of Object.entries(nodeObj.attrs)) {
        element.setAttribute(key, String(value))
      }
    }

    // Add children
    if (Array.isArray(nodeObj.content)) {
      for (const child of nodeObj.content) {
        const childElement = jsonToYXmlElement(child)
        if (childElement) {
          element.push([childElement])
        }
      }
    }

    return element
  }

  return null
}
