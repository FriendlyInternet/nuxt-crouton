/**
 * @crouton-package crouton-sales
 * @description Pure conflict rule for config rows (epic #801, #2769). No DB, no Nitro.
 *
 * Both sync sides run this same function, so the till and the cloud pick the
 * same winner:
 *   - latest edit wins (`updatedAt`; a delete marker counts at `deletedAt`)
 *   - equal timestamps break the tie by `deviceId`, never by arrival order
 *   - while the row's event is live the till wins outright
 *
 * Timestamps must be server-corrected first (`clockOffset` / `correctTimestamp`).
 */

export interface ConfigVersion {
  /** Last edit, epoch ms (server-corrected). */
  updatedAt: number
  /** Set on a delete marker, epoch ms (server-corrected). */
  deletedAt?: number | null
  /** Origin of the edit; deterministic tie-break. */
  deviceId?: string | null
}

/** Which machine is applying the write. */
export type ConflictSide = 'till' | 'cloud'

export interface ConflictContext {
  /** The row's event is `status: 'active'`. */
  eventLive: boolean
  /** The side running this call: `incoming` came from the other side. */
  side: ConflictSide
}

export type ConflictReason = 'till-wins-live' | 'newer' | 'older' | 'tie-break'

export interface ConflictResult {
  decision: 'keep' | 'apply'
  /** For the audit log. */
  reason: ConflictReason
}

/** When the version was last touched: the delete time for a marker, else the edit time. */
export function versionTime(v: ConfigVersion): number {
  return Math.max(v.updatedAt, v.deletedAt ?? Number.NEGATIVE_INFINITY)
}

export function resolveConflict(
  local: ConfigVersion,
  incoming: ConfigVersion,
  { eventLive, side }: ConflictContext,
): ConflictResult {
  if (eventLive) {
    // Incoming came from the till when the cloud applies, and from the cloud when the till applies.
    return { decision: side === 'cloud' ? 'apply' : 'keep', reason: 'till-wins-live' }
  }

  const l = versionTime(local)
  const i = versionTime(incoming)
  if (i > l) return { decision: 'apply', reason: 'newer' }
  if (i < l) return { decision: 'keep', reason: 'older' }

  // Same instant: the higher deviceId wins on both sides, so they converge.
  const ld = local.deviceId ?? ''
  const id = incoming.deviceId ?? ''
  return { decision: id > ld ? 'apply' : 'keep', reason: 'tie-break' }
}

/** Server minus local clock, assuming the reply took half the round trip. */
export function clockOffset(serverNowMs: number, sentAtMs: number, receivedAtMs: number): number {
  return serverNowMs - (sentAtMs + (receivedAtMs - sentAtMs) / 2)
}

/** A local timestamp expressed on the server's clock. */
export function correctTimestamp(localMs: number, offsetMs: number): number {
  return localMs + offsetMs
}
