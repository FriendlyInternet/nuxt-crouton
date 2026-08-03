/**
 * Recording a handover — the write half of the pass screen (#1761).
 *
 * WS1 (#1760) gave `sales_handovers` a composite unique index:
 *
 *     CREATE UNIQUE INDEX sales_handovers_team_order_id_idx
 *       ON sales_handovers (teamId, orderId)
 *
 * which is why this cannot copy `kds-bump`'s check-then-insert. That pattern —
 * SELECT, then INSERT if absent — is a read-then-write race: two taps landing in
 * the gap both see "absent" and both insert. `sales_kdsbumps` has no unique
 * constraint, so there it degrades to a harmless duplicate row. Here it would
 * degrade to a constraint violation in the runner's face, mid-service, on the
 * single gesture this screen exists to absorb.
 *
 * So the insert is conflict-tolerant, and a conflict reads as success: a second
 * tap means "already handed over", which is the outcome the runner wanted.
 *
 * What it must NOT do is swallow errors in general. A missing table or a disk
 * error has to surface — otherwise handovers vanish silently and the outstanding
 * count drifts away from reality, which is the same class of failure as the KDS
 * board that kept serving a stale screen (#1766).
 *
 * Table is injected rather than imported: the tables live in the CONSUMING app's
 * generated layer (`~~/layers/sales/...`), which a package unit test cannot
 * resolve. Keeping it a parameter is what makes this behaviour testable at all.
 */

export type HandoverRequest =
  | { ok: true, eventId: string, orderId: string }
  | { ok: false, message: string }

/**
 * Validate the request before touching the database.
 *
 * Pure on purpose: the handler's own branching is what fallow's CRAP score
 * flags (complexity weighted by lack of coverage), and an endpoint is not unit
 * tested in this package — the pure helpers are. Parsing here makes the rules
 * testable AND leaves the handler with a single guard. Same split as
 * `order-filters.ts` for the orders list.
 */
export function readHandoverRequest(input: {
  eventId: string | undefined
  body: unknown
}): HandoverRequest {
  if (!input.eventId) return { ok: false, message: 'eventId is required' }

  const orderId = (input.body as { orderId?: unknown } | null | undefined)?.orderId
  if (typeof orderId !== 'string' || !orderId) {
    return { ok: false, message: 'orderId is required' }
  }

  return { ok: true, eventId: input.eventId, orderId }
}

export interface RecordHandoverInput {
  /** The generated `salesHandovers` table, passed by the endpoint. */
  table?: unknown
  eventId: string
  orderId: string
  teamId: string
  owner: string
  /** Who performed the handover; lands in createdBy/updatedBy. */
  actor: string
}

/** SQLite/D1 report a uniqueness conflict in the message rather than a code. */
function isUniqueViolation(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? '')
  return /UNIQUE constraint failed/i.test(message)
    || /SQLITE_CONSTRAINT_UNIQUE/i.test(message)
}

/** How many rows the driver says it wrote — drizzle/D1 spell this differently. */
function rowsWritten(result: unknown): number {
  const r = result as { rowsAffected?: number, changes?: number, meta?: { changes?: number } } | undefined
  return r?.rowsAffected ?? r?.changes ?? r?.meta?.changes ?? 0
}

export async function recordHandover(
  db: any,
  input: RecordHandoverInput
): Promise<{ created: boolean }> {
  const now = new Date()

  try {
    const result = await db
      .insert(input.table)
      .values({
        teamId: input.teamId,
        owner: input.owner,
        eventId: input.eventId,
        orderId: input.orderId,
        createdAt: now,
        updatedAt: now,
        createdBy: input.actor,
        updatedBy: input.actor
      })
      // Belt: the database absorbs the race without raising at all.
      .onConflictDoNothing()

    return { created: rowsWritten(result) > 0 }
  }
  catch (error) {
    // Braces: a driver that raises instead of absorbing still reads as success,
    // because the row it conflicted with IS the handover the caller wanted.
    if (isUniqueViolation(error)) return { created: false }
    throw error
  }
}
