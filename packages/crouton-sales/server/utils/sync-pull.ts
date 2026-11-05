/**
 * @crouton-package crouton-sales
 * @description Cloud → till config sync (#815, epic #801).
 *
 * Cloud: `collectConfigChanges` answers "what changed for this team since my
 * cursor" with config rows and delete markers, oldest first, paged.
 *
 * Till: `pullConfigChanges` asks for that after each push, runs every change
 * through `resolveConflict` (side = till) and applies the ones that win. The
 * cursor is kept in `sales_sync_pull_state`. Applying never writes the outbox,
 * so a pulled change is not echoed back to the cloud.
 *
 * Tie rule: the till's own version carries its device id and a cloud version
 * carries none, so on an equal timestamp the till keeps its row. The cloud's
 * ingest applies the same rule from the other side (its stored row has no
 * origin, the till's write has a device id), so both sides settle on the
 * till's version.
 *
 * Time: a row the till applies is stored with `updatedAt = cloudTime - offset`,
 * so correcting it by the offset later gives back exactly the cloud's time.
 */
import { and, asc, eq, gte } from 'drizzle-orm'
import { CONFIG_ENTITY_TYPES, type ConfigEntityType } from './config-capture'
import { correctTimestamp, resolveConflict, type ConfigVersion, type ConflictReason } from './config-conflict'
import { syncAuthHeaders, type PushOptions } from './cloud-sync-pusher'
import { coerceToColumns, liveEventStatus, loadTables, upsertRow } from './sync-ingest'
import { getClockOffset, updateClockOffset } from './sync-clock'
import type { OutboxEntityType } from './sync-outbox'

export const DEFAULT_PULL_LIMIT = 200
const MAX_PULL_PAGES = 20

export interface ConfigChange {
  entityType: ConfigEntityType
  entityId: string
  operation: 'upsert' | 'delete'
  /** Edit time (upsert) or delete time (delete), epoch ms on the cloud's clock. */
  at: number
  /** For a delete: the team the deleted row belonged to. */
  teamId?: string
  /** The full row, for an upsert. */
  row?: Record<string, unknown>
}

export interface PullReply {
  changes: ConfigChange[]
  /** Send back as `since` on the next pull. */
  cursor: number
  /** Send back as `skip`: how many changes at the `cursor` instant the client already has (only while `hasMore`). */
  skip: number
  hasMore: boolean
  serverNow: number
}

const toMs = (v: unknown): number | null => {
  if (v == null) return null
  const ms = v instanceof Date ? v.getTime() : new Date(typeof v === 'number' ? v : String(v)).getTime()
  return Number.isNaN(ms) ? null : ms
}

async function loadTombstones() {
  return (await import('../database/schema')).salesSyncTombstones
}

export interface CollectOptions {
  limit?: number
  /** Changes at exactly `since` to leave out (already delivered on an earlier page). */
  skip?: number
  /** Injectable for tests. */
  tables?: Record<OutboxEntityType, any>
  tombstones?: any
}

/**
 * Cloud side: config changes for `teamId` at or after `since` (epoch ms).
 * The boundary is inclusive because stored times have second precision; a
 * repeated row is harmless since applying is idempotent.
 */
// fallow-ignore-next-line complexity -- one linear pass: read each source, merge, order, page
export async function collectConfigChanges(db: any, teamId: string, since: number, opts: CollectOptions = {}): Promise<PullReply> {
  const limit = Math.max(1, opts.limit ?? DEFAULT_PULL_LIMIT)
  const skip = Math.max(0, opts.skip ?? 0)
  // Each source is read deep enough to cover the skipped changes, one page, and one more to know there is a next page.
  const fetchLimit = limit + skip + 1
  const tables = opts.tables ?? await loadTables()
  const tombstones = opts.tombstones ?? await loadTombstones()
  const from = new Date(Math.max(0, since))
  const all: ConfigChange[] = []

  for (const type of CONFIG_ENTITY_TYPES) {
    const table = tables[type]
    if (!table) continue
    const rows = await db.select().from(table)
      .where(and(eq(table.teamId, teamId), gte(table.updatedAt, from)))
      .orderBy(asc(table.updatedAt)).limit(fetchLimit)
    for (const row of rows) {
      all.push({ entityType: type, entityId: row.id, operation: 'upsert', at: toMs(row.updatedAt) ?? 0, row })
    }
  }
  const marks = await db.select().from(tombstones)
    .where(and(eq(tombstones.teamId, teamId), gte(tombstones.deletedAt, from)))
    .orderBy(asc(tombstones.deletedAt)).limit(fetchLimit)
  for (const m of marks) {
    all.push({ entityType: m.entityType, entityId: m.entityId, operation: 'delete', at: toMs(m.deletedAt) ?? 0, teamId })
  }

  all.sort((a, b) => a.at - b.at || a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId))

  // Drop what the client already has at the `since` instant, then take one page.
  let toSkip = skip
  const fresh = all.filter((c) => {
    if (toSkip > 0 && c.at === since) {
      toSkip--
      return false
    }
    return true
  })
  const hasMore = fresh.length > limit
  const changes = fresh.slice(0, limit)
  const cursor = changes.length > 0 ? changes[changes.length - 1]!.at : since
  const delivered = changes.filter(c => c.at === cursor).length
  return {
    changes,
    cursor,
    skip: hasMore ? delivered + (cursor === since ? skip : 0) : 0,
    hasMore,
    serverNow: Date.now(),
  }
}

/** A config write the till kept its own version of; for the audit log. */
export interface PullKept {
  entityType: ConfigEntityType
  entityId: string
  reason: ConflictReason
  local: ConfigVersion
  incoming: ConfigVersion
}

export interface ApplyPulledResult {
  applied: number
  kept: PullKept[]
  /** Changes for another team, never applied. */
  rejected: number
}

export interface ApplyPulledOptions {
  /** The till's team: a change for any other team is rejected. */
  teamId?: string
  /** The till's device id (tie-break origin). */
  deviceId?: string
  /** Cloud clock minus local clock; defaults to the last learned offset. */
  offsetMs?: number
  tables?: Record<OutboxEntityType, any>
  tombstones?: any
}

/** Till side: apply pulled changes with the conflict rule. Never writes the outbox. */
// fallow-ignore-next-line complexity -- the conflict-rule walk (team guard, tombstone, verdict, apply) reads best in one place
export async function applyPulledChanges(db: any, changes: ConfigChange[], opts: ApplyPulledOptions = {}): Promise<ApplyPulledResult> {
  const result: ApplyPulledResult = { applied: 0, kept: [], rejected: 0 }
  if (changes.length === 0) return result
  const tables = opts.tables ?? await loadTables()
  const tombstones = opts.tombstones ?? await loadTombstones()
  const offset = opts.offsetMs ?? getClockOffset()
  const origin = opts.deviceId || 'till'

  for (const change of changes) {
    const table = tables[change.entityType]
    if (!table) continue
    const incomingTeam = change.row?.teamId as string | undefined
    if (opts.teamId && incomingTeam && incomingTeam !== opts.teamId) {
      result.rejected++
      continue
    }

    const [row] = await db.select().from(table).where(eq(table.id, change.entityId)).limit(1)
    const [mark] = await db.select().from(tombstones)
      .where(and(eq(tombstones.entityType, change.entityType), eq(tombstones.entityId, change.entityId))).limit(1)
    if (row && opts.teamId && row.teamId !== opts.teamId) {
      result.rejected++
      continue
    }

    const isDelete = change.operation === 'delete'
    const incoming: ConfigVersion = isDelete
      ? { updatedAt: change.at, deletedAt: change.at, deviceId: null }
      : { updatedAt: change.at, deletedAt: null, deviceId: null }

    let local: ConfigVersion | null = null
    if (row) local = { updatedAt: correctTimestamp(toMs(row.updatedAt) ?? 0, offset), deviceId: origin }
    else if (mark) local = { updatedAt: 0, deletedAt: correctTimestamp(toMs(mark.deletedAt) ?? 0, offset), deviceId: origin }

    if (local) {
      const status = await liveEventStatus(db, tables, { entityType: change.entityType as OutboxEntityType, entityId: change.entityId, payload: {} }, row, change.row ?? {})
      const verdict = resolveConflict(local, incoming, { eventLive: status === 'active', side: 'till' })
      if (verdict.decision === 'keep') {
        result.kept.push({ entityType: change.entityType, entityId: change.entityId, reason: verdict.reason, local, incoming })
        continue
      }
    }

    if (isDelete) {
      await db.delete(table).where(eq(table.id, change.entityId))
      const deletedAt = new Date(change.at - offset)
      const teamId = (row?.teamId ?? mark?.teamId ?? change.teamId ?? opts.teamId) as string | undefined
      if (teamId) {
        await db.insert(tombstones)
          .values({ entityType: change.entityType, entityId: change.entityId, teamId, deletedAt })
          .onConflictDoUpdate({ target: [tombstones.entityType, tombstones.entityId], set: { deletedAt } })
      }
    }
    else {
      const values = coerceToColumns(table, { ...change.row, id: change.entityId, updatedAt: change.at - offset })
      await upsertRow(db, table, change.entityId, values)
      // A newer cloud edit brings a deleted row back.
      if (mark) await db.delete(tombstones).where(and(eq(tombstones.entityType, change.entityType), eq(tombstones.entityId, change.entityId)))
    }
    result.applied++
  }
  return result
}

export interface PullOptions extends PushOptions {
  /** Pull endpoint URL; defaults to env CROUTON_SALES_CLOUD_SYNC_PULL_URL, else the ingest URL with `/ingest` → `/pull`. */
  pullUrl?: string
  /** The till's team (from pairing); rows for other teams are rejected. */
  teamId?: string
  limit?: number
  maxPages?: number
  tables?: Record<OutboxEntityType, any>
  tombstones?: any
  /** Injectable for tests; the cursor table. */
  pullState?: any
  /** Injectable HTTP client for tests. */
  pullFetcher?: (url: string, init: Record<string, unknown>) => Promise<PullReply>
}

export function resolvePullUrl(opts: PullOptions): string {
  const explicit = opts.pullUrl || process.env.CROUTON_SALES_CLOUD_SYNC_PULL_URL
  if (explicit) return explicit
  const ingest = opts.url || process.env.CROUTON_SALES_CLOUD_SYNC_URL
  if (!ingest) throw new Error('CROUTON_SALES_CLOUD_SYNC_URL not set')
  return ingest.replace(/\/ingest\/?$/, '/pull')
}

export interface PullResult {
  pages: number
  applied: number
  kept: PullKept[]
  rejected: number
  cursor: number
}

/** Till side: pull until caught up (bounded), apply, persist the cursor after each page. */
// fallow-ignore-next-line complexity -- the paged pull loop with cursor persistence; splitting it would scatter the cursor invariants
export async function pullConfigChanges(db: any, opts: PullOptions = {}): Promise<PullResult> {
  const url = resolvePullUrl(opts)
  const headers = syncAuthHeaders(opts)
  const deviceId = opts.deviceId || process.env.CROUTON_SALES_DEVICE_ID || process.env.FANFARE_DEVICE_ID
  // The cloud scopes a pull to the paired device's team; the legacy shared key has none.
  if (!headers['x-device-id']) return { pages: 0, applied: 0, kept: [], rejected: 0, cursor: 0 }
  const stateId = deviceId || 'default'
  const pullState = opts.pullState ?? (await import('../database/schema')).salesSyncPullState
  const doFetch = opts.pullFetcher ?? (globalThis as any).$fetch

  const [state] = await db.select().from(pullState).where(eq(pullState.id, stateId)).limit(1)
  let cursor: number = state?.cursor ?? 0
  let skip: number = state?.skip ?? 0
  const out: PullResult = { pages: 0, applied: 0, kept: [], rejected: 0, cursor }

  for (let page = 0; page < (opts.maxPages ?? MAX_PULL_PAGES); page++) {
    const sentAt = Date.now()
    const reply: PullReply = await doFetch(url, {
      method: 'GET',
      headers,
      query: { since: cursor, skip, limit: opts.limit ?? DEFAULT_PULL_LIMIT },
      timeout: opts.timeoutMs ?? 15000,
      retry: 0,
    })
    updateClockOffset(reply?.serverNow, sentAt, Date.now())
    const changes = Array.isArray(reply?.changes) ? reply.changes : []
    const res = await applyPulledChanges(db, changes, {
      teamId: opts.teamId, deviceId, tables: opts.tables, tombstones: opts.tombstones,
    })
    out.pages++
    out.applied += res.applied
    out.kept.push(...res.kept)
    out.rejected += res.rejected

    const next = typeof reply?.cursor === 'number' ? reply.cursor : cursor
    const nextSkip = typeof reply?.skip === 'number' ? reply.skip : 0
    // Save only after the page is applied: a crash re-pulls it, which is idempotent.
    if (next !== cursor || nextSkip !== skip) {
      const set = { cursor: next, skip: nextSkip, updatedAt: new Date() }
      await db.insert(pullState).values({ id: stateId, ...set }).onConflictDoUpdate({ target: pullState.id, set })
    }
    const advanced = next !== cursor || nextSkip !== skip
    cursor = next
    skip = nextSkip
    out.cursor = cursor
    if (!reply?.hasMore || !advanced) break
  }

  if (out.kept.length > 0) {
    console.info(`[crouton-sales] sync pull kept the till's version for ${out.kept.length} config row(s)`)
  }
  return out
}
