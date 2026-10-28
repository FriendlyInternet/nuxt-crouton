/// <reference types="@cloudflare/workers-types" />

import * as Y from 'yjs'
import { verifyCollabToken } from '../utils/collabToken'

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
 * - Track awareness/presence for all connected users
 *
 * Note: This DO does NOT sync to collection tables. That responsibility
 * belongs to the consumer (e.g., crouton-pages, crouton-flow) who can
 * observe Y.Doc changes and sync to their own tables.
 */
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

    fetch(`${origin}/api/_crouton/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        source: 'crouton-collab',
        teamId: this.teamId ?? undefined,
        metadata,
      }),
    }).catch(() => { /* non-blocking */ })
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
      `).bind(this.roomType, this.roomId, state).run()
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
   * Validate that the request carries a valid Better Auth session cookie.
   *
   * In the Cloudflare DO environment Better Auth is not available, so we
   * forward the session cookie to the app's own auth API for verification.
   * This keeps the DO auth check thin — the heavy lifting stays in the worker.
   *
   * Returns the user ID string on success, or null if the session is absent/invalid.
   */
  /**
   * Verify an HMAC-signed collab token.
   * Token format: base64(JSON payload).base64(HMAC signature)
   */
  private verifyToken(token: string): Promise<string | null> {
    return verifyCollabToken(token, this.env.COLLAB_TOKEN_SECRET)
  }

  /**
   * Validate request auth — supports two modes:
   * 1. Token-based (cross-origin direct WS): ?token=... query param, verified via HMAC
   * 2. Cookie-based (same-origin proxy): forwards session cookie to app's auth endpoint
   */
  private async validateSession(request: Request): Promise<string | null> {
    const url = new URL(request.url)

    // Mode 1: Token-based auth (cross-origin direct connection)
    const token = url.searchParams.get('token')
    if (token) {
      return this.verifyToken(token)
    }

    // Mode 2: Cookie-based auth (same-origin proxy)
    const cookieHeader = request.headers.get('cookie')
    if (!cookieHeader) return null

    const appOrigin = url.searchParams.get('appOrigin') || `https://${url.hostname}`

    try {
      const sessionResponse = await fetch(`${appOrigin}/api/auth/get-session`, {
        headers: { cookie: cookieHeader }
      })
      if (!sessionResponse.ok) return null

      const data = await sessionResponse.json() as { user?: { id: string } } | null
      return data?.user?.id ?? null
    } catch {
      return null
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Capture app origin once — used for emitOperation calls
    if (!this._appOrigin) {
      this._appOrigin = `${url.protocol}//${url.host}`
    }

    // Extract room metadata from query params (set on first connect)
    const roomType = url.searchParams.get('type') || 'generic'
    const roomId = url.searchParams.get('roomId')
    const teamId = url.searchParams.get('teamId')

    if (roomType && roomId && !this.roomId) {
      this.roomType = roomType
      this.roomId = roomId
      this.teamId = teamId ?? null
      await this.storage.put('meta', { roomType, roomId, teamId: teamId ?? null })

      // collab:room:created — emitted exactly once when the DO first initialises for this room
      this.emitOperation('collab:room:created', {
        roomId,
        roomType,
      })
    }

    if (url.pathname === '/ws') {
      // --- Auth check: require a valid session before upgrading to WebSocket ---
      const userId = await this.validateSession(request)
      if (!userId) {
        return new Response('Unauthorized', { status: 4401 })
      }

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

    if (url.pathname === '/users') {
      // HTTP endpoint to get current users (for Phase 6 global presence)
      // Require a valid session before returning presence data
      const userId = await this.validateSession(request)
      if (!userId) {
        return new Response('Unauthorized', { status: 401 })
      }

      const users = Array.from(this.sessions.values())
        .filter(s => s.awarenessState)
        .map(s => s.awarenessState)

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

  private broadcastAwareness(): void {
    const users = Array.from(this.sessions.values())
      .filter(s => s.awarenessState)
      .map(s => s.awarenessState)

    const message = JSON.stringify({ type: 'awareness', users })

    for (const [ws] of this.sessions) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message)
      }
    }
  }
}
