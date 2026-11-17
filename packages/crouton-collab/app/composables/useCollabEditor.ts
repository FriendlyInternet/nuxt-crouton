import * as Y from 'yjs'
import { computed, type Ref, type ComputedRef } from 'vue'
import { useCollabSync } from './useCollabSync'
import { useCollabPresence } from './useCollabPresence'
import type { CollabAwarenessState, CollabUser } from '../types/collab'
import type { CollabAwarenessAdapter } from '../utils/collabAwareness'

export interface UseCollabEditorOptions {
  /** Unique room identifier */
  roomId: string
  /** Room type (default: 'page') */
  roomType?: string
  /** Field name for the editor content (default: 'content') */
  field?: string
  /** User info for presence (auto-detected if not provided) */
  user?: { name: string; color?: string }
}

/**
 * Awareness compatible with TipTap's collaboration caret (`yCursorPlugin`).
 * It is the connection's adapter — see `createCollabAwareness`.
 */
export type CollabAwareness = CollabAwarenessAdapter

/**
 * Provider interface compatible with TipTap Collaboration extension
 */
export interface CollabProvider {
  awareness: CollabAwareness
}

export interface UseCollabEditorReturn {
  // Connection state
  connected: ComputedRef<boolean>
  synced: ComputedRef<boolean>
  error: ComputedRef<Error | null>

  // Yjs for TipTap
  ydoc: Y.Doc
  yxmlFragment: Y.XmlFragment

  // Presence
  user: ComputedRef<CollabUser | null>
  users: Ref<CollabAwarenessState[]>
  otherUsers: ComputedRef<CollabAwarenessState[]>

  // For TipTap Collaboration extension
  provider: CollabProvider

  // Actions
  connect: () => void
  disconnect: () => void
  updateCursor: (cursor: { x: number; y: number } | null) => void
  updateSelection: (selection: { anchor: number; head: number } | null) => void
}

/**
 * Composable for TipTap editor collaboration
 *
 * Provides a ready-to-use setup for collaborative rich text editing with TipTap.
 * Includes Yjs document, XmlFragment, and presence awareness.
 *
 * @example
 * ```ts
 * const {
 *   ydoc,
 *   yxmlFragment,
 *   provider,
 *   connected,
 *   users
 * } = useCollabEditor({
 *   roomId: 'page-123',
 *   user: { name: 'Alice' }
 * })
 *
 * // Use with TipTap
 * import { Collaboration } from '@tiptap/extension-collaboration'
 * import { yCursorPlugin } from '@tiptap/y-tiptap'
 *
 * provider.awareness.setLocalStateField('user', { name: 'Alice' })
 * const editor = useEditor({
 *   extensions: [
 *     Collaboration.configure({ fragment: yxmlFragment }),
 *     Extension.create({
 *       name: 'collabCaret',
 *       addProseMirrorPlugins: () => [yCursorPlugin(provider.awareness)]
 *     })
 *   ]
 * })
 * ```
 */
export function useCollabEditor(options: UseCollabEditorOptions): UseCollabEditorReturn {
  const {
    roomId,
    roomType = 'page',
    field = 'content',
    user: providedUser
  } = options

  // Use useCollabSync with xmlFragment structure
  const sync = useCollabSync({
    roomId,
    roomType,
    structure: 'xmlFragment',
    structureName: field
  })

  const { ydoc, yxmlFragment, connected, synced, error, connection, users, connect, disconnect } = sync

  if (!yxmlFragment) {
    throw new Error('[useCollabEditor] Failed to create Y.XmlFragment')
  }

  // Use presence for cursor tracking
  const presence = useCollabPresence({
    connection,
    user: providedUser
  })

  const { user, otherUsers, updateCursor, updateSelection } = presence

  /**
   * TipTap-compatible provider: the connection's own awareness adapter (#3984), which
   * y-tiptap's `yCursorPlugin` can read (getStates / on('change') / setLocalStateField).
   */
  const provider: CollabProvider = { awareness: connection.awareness }

  return {
    // Connection state
    connected,
    synced,
    error,

    // Yjs for TipTap
    ydoc,
    yxmlFragment,

    // Presence
    user,
    users,
    otherUsers,

    // For TipTap Collaboration extension
    provider,

    // Actions
    connect,
    disconnect,
    updateCursor,
    updateSelection
  }
}
