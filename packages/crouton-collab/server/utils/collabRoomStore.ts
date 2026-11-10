/**
 * Shared in-memory storage for collaboration rooms
 *
 * This module provides a shared room store that can be accessed
 * by both the WebSocket handler and HTTP endpoints.
 *
 * In production with Cloudflare, this is replaced by Durable Objects.
 */
import * as Y from 'yjs'

export interface CollabRoomData {
  doc: Y.Doc
  peers: Set<{ send: (data: unknown) => void }>
  awareness: Map<string, unknown>
  /** Track connection count per userId for deduplication */
  userConnectionCounts: Map<string, number>
}

// Shared room storage
const rooms = new Map<string, CollabRoomData>()

/**
 * Get or create a room by type and ID
 */
export function getOrCreateRoom(roomType: string, roomId: string): CollabRoomData {
  const roomKey = `${roomType}:${roomId}`
  if (!rooms.has(roomKey)) {
    const doc = new Y.Doc()
    rooms.set(roomKey, {
      doc,
      peers: new Set(),
      awareness: new Map(),
      userConnectionCounts: new Map()
    })
  }
  return rooms.get(roomKey)!
}

/**
 * Get a room if it exists (doesn't create)
 */
export function getRoom(roomType: string, roomId: string): CollabRoomData | undefined {
  const roomKey = `${roomType}:${roomId}`
  return rooms.get(roomKey)
}

/**
 * Get users from a specific room
 */
export function getRoomUsers(roomType: string, roomId: string): unknown[] {
  const room = getRoom(roomType, roomId)
  if (!room) return []
  return Array.from(room.awareness.values())
}

/**
 * Get all rooms (for debugging)
 */
export function getAllRooms(): Map<string, CollabRoomData> {
  return rooms
}

/**
 * Signal a collection change from server-side code.
 * Increments the version counter in the team's sync room Y.Map
 * and broadcasts the Yjs update to all connected WebSocket clients.
 *
 * This enables MCP tools, webhooks, and other server-side mutations
 * to trigger real-time UI refreshes without going through the client.
 */
export function signalCollectionChange(teamId: string, collection: string): void {
  const roomId = `${teamId}:team:${teamId}:sync`
  const room = getRoom('sync', roomId)
  if (!room) return

  const ymap = room.doc.getMap<number>('versions')
  const currentVersion = ymap.get(collection) ?? 0
  const newVersion = currentVersion + 1

  // Capture the Yjs update produced by this change
  const updateHandler = (update: Uint8Array) => {
    // Broadcast to all connected peers
    for (const peer of room.peers) {
      try {
        peer.send(update)
      } catch {
        // Peer disconnected
      }
    }
  }

  room.doc.on('update', updateHandler)
  ymap.set(collection, newVersion)
  room.doc.off('update', updateHandler)
}

/**
 * Clear a room (for cleanup/testing)
 */
export function clearRoom(roomType: string, roomId: string): void {
  const roomKey = `${roomType}:${roomId}`
  const room = rooms.get(roomKey)
  if (room) {
    room.doc.destroy()
    rooms.delete(roomKey)
  }
}
