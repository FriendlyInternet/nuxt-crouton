/// <reference types="@cloudflare/workers-types" />

import * as Y from 'yjs'
import { verifyCollabToken, authorizeRoomRequest, parseRoomKey } from '../utils/collabToken'
import { signInternalRequest } from '../utils/internalSignature'
import { COLLAB_PRESENCE_HEADER, createServerPresenceStore, parseServerPresence } from '../utils/collabServerPresence'
import type { CollabAwarenessState } from '../../app/types/collab'

interface Env {
  DB: D1Database
  COLLAB_TOKEN_SECRET?: string
}

interface Session {
  ws: WebSocket
  userId?: string
  awarenessState?: Record<string, unknown>
}

/**
 * Generic Durable Object that manages a single collaborative Yjs document
 *
 * Unlike FlowRoom, this is generic and can be used for any room type:
 * - pages: Y.XmlFragment for TipTap editor content
 * - flows: Y.Map for node graphs
 * - documents: Y.Text for plain text
 *
 * Responsibilities:
 * - Maintain Y.Doc state in memory
 * - Handle WebSocket connections from clients
 * - Merge updates from all clients via Yjs CRDTs
 * - Persist state to D1 (blob only - consumer handles domain syncing)
 * - Broadcast updates to all connected clients
 * - Track awareness/presence for all connected users, plus short-lived
 *   presence of server editors sent with POST /update (#4094, never a session)
 *
 * Note: This DO does NOT sync to collection tables. That responsibility
 * belongs to the consumer (e.g., crouton-pages, crouton-flow) who can
 * observe Y.Doc changes and sync to their own tables.
 */
/**
 * App-server edit (#3982, the MCP pages tools): POST /update carries a raw Yjs update.
 * The room token checked in fetch proves the caller may write this exact room — a WS
 * client with the same token can already send updates. Origin 'server' is not a
 * socket, so the update listener broadcasts to EVERY session and schedules the save.
 *
 * #4094: an optional `X-Collab-Presence` header carries the editor's short-lived
 * presence (e.g. "Claude" + its caret); it goes to `onPresence`. A presence-only
 * request (empty body) is allowed and changes no document state. A malformed
 * presence is ignored — the edit still applies.
 */
export async function applyServerUpdate(
  ydoc: Y.Doc,
  request: Request,
  onPresence?: (presence: CollabAwarenessState) => void
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  }
  const presence = parseServerPresence(request.headers.get(COLLAB_PRESENCE_HEADER))
  const update = new Uint8Array(await request.arrayBuffer())
  if (update.byteLength === 0 && !presence) return new Response('Empty update', { status: 400 })
  if (update.byteLength > 0) {
    try {
      Y.applyUpdate(ydoc, update, 'server')
    } catch {
      return new Response('Invalid update', { status: 400 })
    }
  }
  if (presence) onPresence?.(presence)
  return new Response('ok', { status: 200 })
}

export class CollabRoom implements DurableObject {
  private ydoc: Y.Doc
  private sessions: Map<WebSocket, Session> = new Map()
  private storage: DurableObjectStorage
  private env: Env
  private roomType: string = ''
  private roomId: string = ''
  private teamId: string | null = null
  private persistTimeout: ReturnType<typeof setTimeout> | null = null
  /** Tracks the last time collab:synced was emitted to debounce high-frequency saves */
  private lastSyncEmitAt: number = 0
  private readonly SYNC_EMIT_DEBOUNCE_MS = 30_000
  /** Server editors' presence (#4094) — never sessions; they expire by themselves. */
  private serverPresence = createServerPresenceStore()
  private presenceTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(state: DurableObjectState, env: Env) {
    this.storage = state.storage
    this.env = env
    this.ydoc = new Y.Doc()

    // Load persisted state on startup
    state.blockConcurrencyWhile(async () => {
      await this.loadState()
    })

    // Set up update handler
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      // Don't persist updates that came from loading storage
      if (origin === 'storage') return

      // Broadcast to all clients except origin
      this.broadcast(update, origin as WebSocket | undefined)

      // Debounced persistence
      this.schedulePersist()
    })
  }

  /**
   * Emit a crouton:operation event via the internal Nitro bridge endpoint.
   *
   * Durable Objects run in a Workers-isolated environment where useNitroApp()
   * is unavailable. We POST to a Nitro endpoint on the same origin which
   * re-emits the event into Nitro's hook system. Non-blocking — any failure
   * is swallowed so telemetry never breaks collaboration.
   */
  private emitOperation(type: string, metadata: Record<string, unknown>): void {
    const origin = this._appOrigin
    if (!origin) return

    const secret = this.env.COLLAB_TOKEN_SECRET
    if (!secret) return
    const body = JSON.stringify({
      type,
      source: 'crouton-collab',
      teamId: this.teamId ?? undefined,
      metadata,
    })
    const timestamp = String(Date.now())
    signInternalRequest(secret, timestamp, body)
      .then(signature => fetch(`${origin}/api/_crouton/operation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-crouton-timestamp': timestamp,
          'x-crouton-signature': signature,
        },
        body,
      }))
      .catch(() => { /* non-blocking */ })
  }

  /** App origin derived on first fetch request, used for emitOperation calls */
  private _appOrigin: string | null = null

  private async loadState(): Promise<void> {
    // Load Yjs state from DO storage (fast, local)
    const stored = await this.storage.get<Uint8Array>('yjs-state')
    if (stored) {
      Y.applyUpdate(this.ydoc, stored, 'storage')
    }

    // Load metadata
    const meta = await this.storage.get<{ roomType: string; roomId: string; teamId?: string | null }>('meta')
    if (meta) {
      this.roomType = meta.roomType
      this.roomId = meta.roomId
      this.teamId = meta.teamId ?? null
    }
  }

  private schedulePersist(): void {
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout)
    }

    // Debounce persistence by 1 second
    this.persistTimeout = setTimeout(() => {
      this.persist()
    }, 1000)
  }

  private async persist(): Promise<void> {
    const state = Y.encodeStateAsUpdate(this.ydoc)

    // 1. Save to Durable Object storage (fast, local)
    await this.storage.put('yjs-state', state)

    // 2. Save to D1 (durable, queryable)
    await this.persistToD1(state)
  }

  private async persistToD1(state: Uint8Array): Promise<void> {
    if (!this.roomType || !this.roomId) return

    try {
      // Save Yjs blob state to generic table
      // Note: We don't sync to collection tables - that's the consumer's job
      await this.env.DB.prepare(`
        INSERT INTO yjs_collab_states (room_type, room_id, state, updated_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(room_type, room_id) DO UPDATE SET
          state = excluded.state,
          version = yjs_collab_states.version + 1,
          updated_at = excluded.updated_at
      `).bind(this.roomType, `${this.teamId}:${this.roomId}`, state).run()
    } catch (error) {
      console.error('[CollabRoom] D1 persistence error:', error)
    }

    // Emit collab:synced — debounced to at most once per 30 seconds to avoid noise
    const now = Date.now()
    if (now - this.lastSyncEmitAt >= this.SYNC_EMIT_DEBOUNCE_MS) {
      this.lastSyncEmitAt = now
      this.emitOperation('collab:synced', {
        roomId: this.roomId,
        roomType: this.roomType,
        updateSize: state.byteLength,
        userCount: this.sessions.size,
      })
    }
  }

  private broadcast(update: Uint8Array, origin?: WebSocket): void {
    for (const [ws, _session] of this.sessions) {
      if (ws !== origin && ws.readyState === WebSocket.OPEN) {
        ws.send(update)
      }
    }
  }

  /**
   * Authorize a request: a valid HMAC token that names exactly this room (and the room
   * is in the token's team). Cookie mode was removed (#3134) — it trusted a
   * request-supplied address. Returns the userId, or null.
   */
  private async validateSession(request: Request): Promise<string | null> {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (!token) return null
    const claims = await verifyCollabToken(token, this.env.COLLAB_TOKEN_SECRET)
    return authorizeRoomRequest(claims, url.searchParams.get('roomKey'))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Authorize first: nothing below runs for an unauthorized request
    const userId = await this.validateSession(request)
    if (!userId) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Capture app origin once — used for emitOperation calls
    if (!this._appOrigin) {
      this._appOrigin = `${url.protocol}//${url.host}`
    }

    // Room identity comes from the worker-set roomKey (already matched to the token)
    const parsed = parseRoomKey(url.searchParams.get('roomKey') as string)
    if (!parsed) return new Response('Bad request', { status: 400 })
    const { teamId, roomType, roomId } = parsed

    if (!this.roomId) {
      this.roomType = roomType
      this.roomId = roomId
      this.teamId = teamId
      await this.storage.put('meta', { roomType, roomId, teamId })

      // collab:room:created — emitted exactly once when the DO first initialises for this room
      this.emitOperation('collab:room:created', {
        roomId,
        roomType,
      })
    }

    if (url.pathname === '/ws') {
      // WebSocket upgrade
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      await this.handleSession(server, userId, teamId)

      return new Response(null, {
        status: 101,
        webSocket: client
      })
    }

    if (url.pathname === '/state') {
      // HTTP endpoint to get current state (for SSR/initial load)
      const state = Y.encodeStateAsUpdate(this.ydoc)
      return new Response(state.buffer as ArrayBuffer, {
        headers: { 'Content-Type': 'application/octet-stream' }
      })
    }

    if (url.pathname === '/update') {
      return applyServerUpdate(this.ydoc, request, presence => this.setServerPresence(presence))
    }

    if (url.pathname === '/users') {
      // HTTP endpoint to get current users (for Phase 6 global presence)
      const users = this.awarenessUsers()

      return new Response(JSON.stringify({ users, count: users.length }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response('Not found', { status: 404 })
  }

  private async handleSession(ws: WebSocket, userId: string, _teamId: string | null): Promise<void> {
    ws.accept()

    const wasEmpty = this.sessions.size === 0
    const session: Session = { ws, userId }
    this.sessions.set(ws, session)

    // collab:user:joined — only when the room transitions from idle (0 users) to active (1+ users)
    if (wasEmpty) {
      this.emitOperation('collab:user:joined', {
        roomId: this.roomId,
        roomType: this.roomType,
        userId,
        userCount: this.sessions.size,
      })
    }

    // Send current state to new client
    const state = Y.encodeStateAsUpdate(this.ydoc)
    ws.send(state)

    // Also send current awareness state
    this.broadcastAwareness()

    ws.addEventListener('message', async (event) => {
      try {
        const data = event.data

        if (data instanceof ArrayBuffer) {
          // Yjs update (binary)
          const update = new Uint8Array(data)
          Y.applyUpdate(this.ydoc, update, ws)
        } else if (typeof data === 'string') {
          // JSON message (awareness, ping, etc.)
          const message = JSON.parse(data)
          await this.handleMessage(ws, session, message)
        }
      } catch (error) {
        console.error('[CollabRoom] Message handling error:', error)
      }
    })

    ws.addEventListener('close', () => {
      this.sessions.delete(ws)

      // collab:user:left — only when the room transitions from active to idle (0 users)
      if (this.sessions.size === 0) {
        this.emitOperation('collab:user:left', {
          roomId: this.roomId,
          roomType: this.roomType,
          userId: session.userId ?? userId,
          userCount: 0,
        })
      }

      // Broadcast user left
      if (session.userId) {
        this.broadcastAwareness()
      }
    })

    ws.addEventListener('error', (error) => {
      console.error('[CollabRoom] WebSocket error:', error)
      this.sessions.delete(ws)
    })
  }

  private async handleMessage(
    ws: WebSocket,
    session: Session,
    message: Record<string, unknown>
  ): Promise<void> {
    switch (message.type) {
      case 'awareness':
        session.userId = message.userId as string
        session.awarenessState = message.state as Record<string, unknown>
        this.broadcastAwareness()
        break

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
    }
  }

  /** People's awareness (one per session) plus live server presences (#4094). */
  private awarenessUsers(): Record<string, unknown>[] {
    const people = Array.from(this.sessions.values())
      .filter(s => s.awarenessState)
      .map(s => s.awarenessState as Record<string, unknown>)
    return [...people, ...this.serverPresence.list()]
  }

  /**
   * Show a server editor's presence for a few seconds (#4094). Not a session: it is
   * not counted in join/leave/userCount, and a timer drops it and re-broadcasts.
   */
  private setServerPresence(presence: CollabAwarenessState): void {
    this.serverPresence.set(presence)
    this.broadcastAwareness()
    if (this.presenceTimeout) clearTimeout(this.presenceTimeout)
    this.presenceTimeout = setTimeout(() => {
      this.presenceTimeout = null
      if (this.serverPresence.prune()) this.broadcastAwareness()
    }, this.serverPresence.ttlMs)
  }

  private broadcastAwareness(): void {
    if (this.sessions.size === 0) return
    const message = JSON.stringify({ type: 'awareness', users: this.awarenessUsers() })

    for (const [ws] of this.sessions) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message)
      }
    }
  }
}
