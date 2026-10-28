/**
 * @module collab
 * @description Types for the Crouton collaboration layer
 *
 * This module provides TypeScript interfaces for real-time collaboration
 * features using Yjs CRDTs. It supports multiple collaboration modes:
 * - Rich text editing (pages)
 * - Node graph editing (flows)
 * - Plain text editing (documents)
 *
 * @example
 * ```ts
 * import type { CollabUser, CollabAwarenessState } from '@fyit/crouton-collab'
 *
 * const user: CollabUser = {
 *   id: 'user-123',
 *   name: 'Alice',
 *   color: '#ff0000'
 * }
 * ```
 */

/**
 * User information for collaboration sessions.
 *
 * Each user in a collaboration room has a unique ID, display name,
 * and color for their cursor/selection highlighting.
 *
 * @example
 * ```ts
 * const user: CollabUser = {
 *   id: 'user-123',
 *   name: 'Alice Smith',
 *   color: '#ff0000'
 * }
 * ```
 */
export interface CollabUser {
  /**
   * Unique identifier for the user.
   * Typically matches the user ID from your authentication system.
   */
  id: string

  /**
   * Display name shown to other collaborators.
   * Used for cursor labels and presence indicators.
   */
  name: string

  /** Profile image URL; initials are shown when absent. */
  image?: string

  /**
   * Hex color for the user's cursor and selection highlighting.
   * Should be a 6-character hex color code (e.g., '#ff0000').
   * Auto-generated if not provided.
   */
  color: string
}

/**
 * Awareness state for presence tracking.
 *
 * Each user in a room broadcasts their awareness state, which includes
 * their cursor position, selection, and any domain-specific data like
 * selected nodes in a flow editor.
 *
 * The interface is extensible via index signature for custom properties.
 *
 * @example
 * ```ts
 * const awarenessState: CollabAwarenessState = {
 *   user: { id: 'user-123', name: 'Alice', color: '#ff0000' },
 *   cursor: { x: 100, y: 200 },
 *   selection: { anchor: 10, head: 20 },
 *   selectedNodeId: 'node-456' // For flow editors
 * }
 * ```
 */
export interface CollabAwarenessState {
  /**
   * The user this awareness state belongs to.
   * Required for identifying the user in the room.
   */
  user: CollabUser

  /**
   * Current cursor position in the editing area.
   * Null when cursor is outside the editable region.
   */
  cursor: { x: number; y: number } | null

  /**
   * Text selection range for rich text editors.
   * Uses TipTap/ProseMirror anchor/head positions.
   */
  selection?: { anchor: number; head: number } | null

  /**
   * ID of the currently selected node in a flow editor.
   * Used to show selection borders on nodes for other users.
   */
  selectedNodeId?: string | null

  /**
   * Ghost node for drag-and-drop preview in flow editors.
   * Shows where a node is being dragged by another user.
   */
  ghostNode?: { id: string; position: { x: number; y: number } } | null

  /**
   * Index signature for custom awareness properties.
   * Add domain-specific data as needed.
   */
  [key: string]: unknown
}

/**
 * Connection state for a collaboration room.
 *
 * Tracks the WebSocket connection status and sync state.
 *
 * @example
 * ```ts
 * const state: CollabConnectionState = {
 *   connected: true,
 *   synced: true,
 *   error: null
 * }
 * ```
 */
export interface CollabConnectionState {
  /**
   * Whether the WebSocket is connected.
   * True after successful WebSocket handshake.
   */
  connected: boolean

  /**
   * Whether initial sync with the server is complete.
   * True after receiving and applying the full Y.Doc state.
   */
  synced: boolean

  /**
   * Connection error, if any.
   * Set when WebSocket connection fails or drops.
   */
  error: Error | null
}

/**
 * Supported Yjs data structure types.
 *
 * Each structure type maps to a Yjs shared type:
 *
 * | Type | Yjs Type | Use Case |
 * |------|----------|----------|
 * | `map` | `Y.Map` | Key-value data, node graphs |
 * | `array` | `Y.Array` | Ordered lists |
 * | `xmlFragment` | `Y.XmlFragment` | Rich text (TipTap) |
 * | `text` | `Y.Text` | Plain text |
 *
 * @example
 * ```ts
 * // For flow editor
 * useCollabSync({ roomId: 'flow-123', roomType: 'flow', structure: 'map' })
 *
 * // For rich text editor
 * useCollabSync({ roomId: 'page-123', roomType: 'page', structure: 'xmlFragment' })
 * ```
 */
export type CollabStructure = 'map' | 'array' | 'xmlFragment' | 'text'

/**
 * Options for the useCollabSync composable.
 *
 * @see {@link CollabStructure} for structure options
 *
 * @example
 * ```ts
 * const options: UseCollabSyncOptions = {
 *   roomId: 'flow-123',
 *   roomType: 'flow',
 *   structure: 'map',
 *   structureName: 'nodes'
 * }
 * ```
 */
export interface UseCollabSyncOptions {
  /**
   * Unique room identifier.
   * Typically composed of collection name and record ID.
   */
  roomId: string

  /**
   * Room type for routing and structure hints.
   * Common values: 'page', 'flow', 'document'.
   */
  roomType: string

  /**
   * Yjs data structure to use for synchronization.
   * @see {@link CollabStructure}
   */
  structure: CollabStructure

  /**
   * Name for the structure in Y.Doc.
   * Defaults to roomType if not specified.
   */
  structureName?: string
}

/**
 * Options for the useCollabEditor composable (TipTap integration).
 *
 * @example
 * ```ts
 * const { ydoc, provider, users } = useCollabEditor({
 *   roomId: 'page-123',
 *   roomType: 'page',
 *   field: 'content',
 *   user: { name: 'Alice', color: '#ff0000' }
 * })
 * ```
 */
export interface UseCollabEditorOptions {
  /**
   * Unique room identifier.
   * Typically the page or document ID.
   */
  roomId: string

  /**
   * Room type for the WebSocket connection.
   * @default 'page'
   */
  roomType?: string

  /**
   * Field name for the editor content in Y.Doc.
   * @default 'content'
   */
  field?: string

  /**
   * User info for presence display.
   * If not provided, auto-detected from session.
   */
  user?: { name: string; color: string }
}

/**
 * JSON messages sent over the WebSocket connection.
 *
 * Binary messages (Uint8Array) are Yjs updates.
 * JSON messages handle awareness and connection health.
 *
 * @example
 * ```ts
 * // Awareness update from client
 * const msg: CollabRoomMessage = {
 *   type: 'awareness',
 *   userId: 'user-123',
 *   state: { user: {...}, cursor: {...} }
 * }
 *
 * // Ping for connection health
 * const ping: CollabRoomMessage = { type: 'ping' }
 * ```
 */
export interface CollabRoomMessage {
  /**
   * Message type discriminator.
   * - 'awareness': User presence update
   * - 'ping': Client heartbeat
   * - 'pong': Server heartbeat response
   */
  type: 'awareness' | 'ping' | 'pong'

  /**
   * User ID for awareness messages.
   */
  userId?: string

  /**
   * Awareness state for a single user.
   */
  state?: CollabAwarenessState

  /**
   * All users' awareness states (broadcast from server).
   */
  users?: CollabAwarenessState[]
}

/**
 * Full sync state including connection and users.
 *
 * Extends {@link CollabConnectionState} with user list.
 *
 * @example
 * ```ts
 * const syncState: CollabSyncState = {
 *   connected: true,
 *   synced: true,
 *   error: null,
 *   users: [{ user: {...}, cursor: {...} }]
 * }
 * ```
 */
export interface CollabSyncState extends CollabConnectionState {
  /**
   * List of all users in the room with their awareness states.
   */
  users: CollabAwarenessState[]
}

/**
 * Options for the CollabRoom Durable Object.
 *
 * Passed via query params when connecting to the WebSocket endpoint.
 *
 * @example
 * ```
 * /api/collab/page-123/ws?type=page&collection=pages
 * ```
 */
export interface CollabRoomOptions {
  /**
   * Room type for data structure hints.
   * Determines the expected Yjs structure.
   */
  type: string

  /**
   * Room ID from URL path.
   * Unique identifier for this collaboration room.
   */
  roomId: string

  /**
   * Optional collection name for future audit/logging.
   */
  collection?: string
}
