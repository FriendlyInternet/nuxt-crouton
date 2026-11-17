/**
 * Short-lived presence for an app-server editor (#4094) — e.g. Claude editing a
 * page through the MCP pages tools.
 *
 * The server edits with `POST /update` and never opens a WebSocket, so it has no
 * session and therefore no awareness. It may send a presence with the update (the
 * `X-Collab-Presence` header, URI-encoded JSON, same wire shape as a person's
 * awareness from `collabAwareness.ts`). The room keeps it here, adds it to every
 * awareness broadcast and `/users`, and drops it by itself shortly after its last
 * update.
 *
 * The rule: a server presence is NEVER a session — it cannot write, it never
 * counts towards the room's users (join/leave/idle), and it expires on its own.
 *
 * Pure and runtime-free so the Durable Object and tests share it.
 */
import type { CollabAwarenessState } from '../../app/types/collab'

export const COLLAB_PRESENCE_HEADER = 'X-Collab-Presence'

/** How long a server presence stays after its last update. */
export const SERVER_PRESENCE_TTL_MS = 5_000

/** Max size of the encoded header value. */
const MAX_PRESENCE_LENGTH = 4096

/** What the app server sends (the room fills in the rest of the wire shape). */
export interface CollabServerPresence {
  /** Stable per editor (e.g. per pages token) — the key the room and carets use. */
  clientId: number
  user: { id?: string; name: string; color: string }
  /** Yjs relative-position JSON, like a person's `caret`. */
  caret?: { anchor: unknown; head: unknown } | null
  /** Root name of the fragment the caret is in, e.g. `content-fr`. */
  fragment?: string | null
  /** Top-level block the caret is in. */
  block?: { index: number; type: string } | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shortString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

/** Encode a presence for the header. */
export function encodeServerPresence(presence: CollabServerPresence): string {
  return encodeURIComponent(JSON.stringify(presence))
}

/**
 * Parse and whitelist a presence header into the awareness wire shape.
 * Anything malformed → null (the update itself is still applied).
 */
export function parseServerPresence(raw: string | null | undefined): CollabAwarenessState | null {
  if (!raw || raw.length > MAX_PRESENCE_LENGTH) return null
  let value: unknown
  try {
    value = JSON.parse(decodeURIComponent(raw))
  } catch {
    return null
  }
  if (!isObject(value) || !isObject(value.user)) return null
  const clientId = value.clientId
  if (typeof clientId !== 'number' || !Number.isSafeInteger(clientId) || clientId < 0) return null
  const name = shortString(value.user.name, 64)
  const color = shortString(value.user.color, 32)
  if (!name || !color || !/^#[0-9a-f]{3,8}$/i.test(color)) return null
  const id = shortString(value.user.id, 128) ?? `server-${clientId}`

  const caret = isObject(value.caret) && isObject(value.caret.anchor) && isObject(value.caret.head)
    ? { anchor: value.caret.anchor, head: value.caret.head }
    : null
  const block = isObject(value.block) && Number.isInteger(value.block.index) && typeof value.block.type === 'string'
    ? { index: value.block.index as number, type: (value.block.type as string).slice(0, 64) }
    : null

  return {
    user: { id, name, color },
    clientId,
    cursor: null,
    caret,
    fragment: shortString(value.fragment, 64),
    block,
    server: true
  }
}

/** Live server presences of one room, keyed by clientId, each with its own expiry. */
export function createServerPresenceStore(ttlMs: number = SERVER_PRESENCE_TTL_MS) {
  const entries = new Map<number, { state: CollabAwarenessState; expiresAt: number }>()

  return {
    ttlMs,
    set(state: CollabAwarenessState, now: number = Date.now()): void {
      entries.set(state.clientId as number, { state, expiresAt: now + ttlMs })
    },
    /** Drop expired entries; true when something was removed. */
    prune(now: number = Date.now()): boolean {
      let removed = false
      for (const [id, entry] of entries) {
        if (entry.expiresAt <= now) {
          entries.delete(id)
          removed = true
        }
      }
      return removed
    },
    /** Live entries (expired ones pruned first). */
    list(now: number = Date.now()): CollabAwarenessState[] {
      this.prune(now)
      return Array.from(entries.values(), e => e.state)
    },
    get size(): number {
      return entries.size
    }
  }
}
