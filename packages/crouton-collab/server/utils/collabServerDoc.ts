/**
 * Read and edit a live collab room from the app server (#3982).
 *
 * Used by server code that must change what an open editor shows WITHOUT saving
 * the record for the user (the MCP pages tools). Two modes:
 *
 * - **Worker** (`runtimeConfig.public.collabWorkerUrl` set — the `"collab": true`
 *   deploy): sign a short room token, `GET /state` into a fresh doc, run the edit,
 *   then `POST /update` with ONLY the diff, so concurrent typing merges as a CRDT.
 *   The DO broadcasts it to every open editor and persists the room.
 * - **Local** (dev, no worker URL): edit the in-process room (`collabRoomStore`)
 *   and push the update to its connected peers.
 *
 * Production without a worker URL is an error — this never falls back to writing
 * the stored record. Nothing here touches a collection table.
 */
import * as Y from 'yjs'
import { signCollabToken } from './collabToken'
import { getOrCreateRoom } from './collabRoomStore'

export interface CollabRoomRef {
  /** Canonical team id (the room is team-scoped). */
  teamId: string
  /** Room type, e.g. `pagesPages`. */
  roomType: string
  /** Room id within the type, e.g. `pagesPages-<pageId>`. */
  roomId: string
}

export interface CollabServerDocOptions {
  /** Override the worker URL (default: `runtimeConfig.public.collabWorkerUrl`). */
  workerUrl?: string | null
  /** Override the token secret (default: `process.env.COLLAB_TOKEN_SECRET`). */
  secret?: string
  /** Allow the in-process room when there is no worker URL (default: dev only). */
  allowLocal?: boolean
  /** fetch implementation (default: global fetch). */
  fetch?: typeof fetch
}

export const COLLAB_NOT_LIVE_ERROR = 'live editing needs collab ("collab": true)'

interface ResolvedMode {
  workerUrl: string | null
  allowLocal: boolean
}

function resolveMode(options: CollabServerDocOptions): ResolvedMode {
  let workerUrl = options.workerUrl
  if (workerUrl === undefined) {
    try {
      workerUrl = (useRuntimeConfig().public as Record<string, unknown>)?.collabWorkerUrl as string | undefined
    } catch {
      workerUrl = undefined
    }
  }
  const allowLocal = options.allowLocal ?? Boolean((import.meta as { dev?: boolean }).dev)
  return { workerUrl: workerUrl ? String(workerUrl) : null, allowLocal }
}

/** The full room key the worker and the token use: `${teamId}:${roomType}:${roomId}`. */
export function collabRoomKey(ref: CollabRoomRef): string {
  return `${ref.teamId}:${ref.roomType}:${ref.roomId}`
}

function workerBase(url: string): string {
  return url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '')
}

function copyDoc(source: Y.Doc): Y.Doc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source))
  return doc
}

async function workerRequest(
  ref: CollabRoomRef,
  actorId: string,
  workerUrl: string,
  options: CollabServerDocOptions
): Promise<{ stateUrl: string, updateUrl: string, doFetch: typeof fetch }> {
  const roomKey = collabRoomKey(ref)
  const secret = options.secret ?? process.env.COLLAB_TOKEN_SECRET
  const token = await signCollabToken({ userId: actorId, teamId: ref.teamId, room: roomKey }, secret)
  const base = `${workerBase(workerUrl)}/${encodeURIComponent(roomKey)}`
  const q = `token=${encodeURIComponent(token)}`
  return {
    stateUrl: `${base}/state?${q}`,
    updateUrl: `${base}/update?${q}`,
    doFetch: options.fetch ?? fetch
  }
}

async function fetchWorkerState(stateUrl: string, doFetch: typeof fetch): Promise<Y.Doc> {
  const res = await doFetch(stateUrl, { method: 'GET' })
  if (!res.ok) throw new Error(`collab worker /state answered ${res.status}`)
  const doc = new Y.Doc()
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > 0) Y.applyUpdate(doc, bytes, 'remote')
  return doc
}

/**
 * A snapshot of the room's current document (a fresh `Y.Doc`; editing it changes
 * nothing). `{ doc: null, error }` when live editing is not available.
 */
export async function readCollabRoomDoc(
  ref: CollabRoomRef & { actorId?: string },
  options: CollabServerDocOptions = {}
): Promise<{ doc: Y.Doc | null, error: string | null }> {
  const { workerUrl, allowLocal } = resolveMode(options)
  try {
    if (workerUrl) {
      const { stateUrl, doFetch } = await workerRequest(ref, ref.actorId ?? 'server', workerUrl, options)
      return { doc: await fetchWorkerState(stateUrl, doFetch), error: null }
    }
    if (!allowLocal) return { doc: null, error: COLLAB_NOT_LIVE_ERROR }
    const room = getOrCreateRoom(ref.roomType, `${ref.teamId}:${ref.roomId}`)
    return { doc: copyDoc(room.doc), error: null }
  } catch (error) {
    return { doc: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Run `mutate` against the room's live document in one transaction and push the
 * resulting change to everyone in the room. Returns the post-edit snapshot and
 * whatever `mutate` returned. A throw inside `mutate` (e.g. a `RangeError` from
 * `editYFragment`) sends nothing and comes back as `error`.
 */
export async function updateCollabRoomDoc<T = void>(
  ref: CollabRoomRef & { actorId: string },
  mutate: (doc: Y.Doc) => T,
  options: CollabServerDocOptions = {}
): Promise<{ doc: Y.Doc | null, result?: T, error: string | null }> {
  const { workerUrl, allowLocal } = resolveMode(options)
  try {
    if (workerUrl) return await updateViaWorker(ref, mutate, workerUrl, options)
    if (!allowLocal) return { doc: null, error: COLLAB_NOT_LIVE_ERROR }
    return updateLocalRoom(ref, mutate)
  } catch (error) {
    return { doc: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Run `mutate` and collect the Yjs updates it produced. */
function mutateCapturing<T>(doc: Y.Doc, mutate: (doc: Y.Doc) => T): { result: T, updates: Uint8Array[] } {
  const updates: Uint8Array[] = []
  const onUpdate = (update: Uint8Array) => { updates.push(update) }
  doc.on('update', onUpdate)
  try {
    return { result: runTransaction(doc, mutate), updates }
  } finally {
    doc.off('update', onUpdate)
  }
}

async function updateViaWorker<T>(
  ref: CollabRoomRef & { actorId: string },
  mutate: (doc: Y.Doc) => T,
  workerUrl: string,
  options: CollabServerDocOptions
): Promise<{ doc: Y.Doc | null, result?: T, error: string | null }> {
  const { stateUrl, updateUrl, doFetch } = await workerRequest(ref, ref.actorId, workerUrl, options)
  const doc = await fetchWorkerState(stateUrl, doFetch)
  const before = Y.encodeStateVector(doc)
  const { result, updates } = mutateCapturing(doc, mutate)
  if (updates.length === 0) return { doc, result, error: null }

  // Only the diff since the fetched state — the room merges it with any
  // concurrent edit instead of being overwritten.
  const res = await doFetch(updateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    // Yjs types it as Uint8Array<ArrayBufferLike>; it is a fresh ArrayBuffer-backed array
    body: Y.encodeStateAsUpdate(doc, before) as Uint8Array<ArrayBuffer>
  })
  if (!res.ok) return { doc: null, error: `collab worker /update answered ${res.status}` }
  return { doc, result, error: null }
}

function updateLocalRoom<T>(
  ref: CollabRoomRef,
  mutate: (doc: Y.Doc) => T
): { doc: Y.Doc, result: T, error: null } {
  const room = getOrCreateRoom(ref.roomType, `${ref.teamId}:${ref.roomId}`)
  const { result, updates } = mutateCapturing(room.doc, mutate)
  for (const update of updates) broadcastToPeers(room.peers, update)
  return { doc: copyDoc(room.doc), result, error: null }
}

function broadcastToPeers(peers: Set<{ send: (data: unknown) => void }>, update: Uint8Array): void {
  for (const peer of peers) {
    try {
      peer.send(update)
    } catch {
      // Peer disconnected
    }
  }
}

/**
 * Run `mutate` in one transaction. Yjs has no rollback, so a throw mid-edit could
 * leave a half-applied change: the edit runs on a scratch copy first and only a
 * clean run is replayed on the real doc.
 */
function runTransaction<T>(doc: Y.Doc, mutate: (doc: Y.Doc) => T): T {
  const scratch = copyDoc(doc)
  scratch.transact(() => { mutate(scratch) }, 'server')
  scratch.destroy()
  let result!: T
  doc.transact(() => { result = mutate(doc) }, 'server')
  return result
}
