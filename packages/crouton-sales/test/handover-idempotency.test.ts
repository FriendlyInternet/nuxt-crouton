/**
 * `recordHandover` — idempotency contract (#1761).
 *
 * WS1 (#1760) shipped a composite unique index:
 *
 *     CREATE UNIQUE INDEX sales_handovers_team_order_id_idx
 *       ON sales_handovers (teamId, orderId)
 *
 * which means this endpoint CANNOT be made idempotent the way `kds-bump` is.
 * That one does a check-then-insert:
 *
 *     const [existing] = await db.select()...limit(1)
 *     if (!existing) await db.insert(...)
 *
 * — a read-then-write race. Two taps landing between the SELECT and the INSERT
 * both see "absent" and both insert. `sales_kdsbumps` has no unique constraint,
 * so that degrades to a harmless duplicate row. Here it degrades to a CONSTRAINT
 * VIOLATION in the runner's face, mid-service, on the one gesture the pass
 * screen exists to absorb.
 *
 * So the insert must be conflict-tolerant at the database level, and a conflict
 * must read as success — a second tap means "already handed over", which is the
 * outcome the user wanted anyway.
 *
 * The one thing it must NOT do is swallow errors generally: a real failure
 * (table missing, disk error) has to surface, or the pass silently loses
 * handovers and the outstanding count drifts from reality.
 */
import { describe, it, expect } from 'vitest'
import { readHandoverRequest, recordHandover } from '../server/utils/handover'

describe('readHandoverRequest', () => {
  it('accepts a well-formed request', () => {
    expect(readHandoverRequest({ eventId: 'evt-1', body: { orderId: 'order-1' } }))
      .toEqual({ ok: true, eventId: 'evt-1', orderId: 'order-1' })
  })

  it('rejects a missing eventId', () => {
    expect(readHandoverRequest({ eventId: undefined, body: { orderId: 'order-1' } }))
      .toEqual({ ok: false, message: 'eventId is required' })
  })

  it('rejects a missing orderId', () => {
    expect(readHandoverRequest({ eventId: 'evt-1', body: {} }))
      .toMatchObject({ ok: false })
  })

  it('rejects a non-string orderId rather than coercing it', () => {
    // A number would stringify into a lookup that silently matches nothing.
    expect(readHandoverRequest({ eventId: 'evt-1', body: { orderId: 42 } }))
      .toMatchObject({ ok: false })
  })

  it('rejects an empty-string orderId', () => {
    expect(readHandoverRequest({ eventId: 'evt-1', body: { orderId: '' } }))
      .toMatchObject({ ok: false })
  })

  it('tolerates a missing or null body', () => {
    expect(readHandoverRequest({ eventId: 'evt-1', body: null })).toMatchObject({ ok: false })
    expect(readHandoverRequest({ eventId: 'evt-1', body: undefined })).toMatchObject({ ok: false })
  })
})

/** A db whose insert behaves however the test needs. */
function fakeDb(onInsert: (values: any) => any) {
  const inserted: any[] = []
  return {
    inserted,
    insert: () => ({
      values: (v: any) => {
        const result = onInsert(v)
        // drizzle's insert builder is thenable; onConflictDoNothing returns it too.
        const builder: any = {
          onConflictDoNothing: () => builder,
          then: (res: any, rej: any) => Promise.resolve()
            .then(() => { if (result instanceof Error) throw result; inserted.push(v); return result })
            .then(res, rej)
        }
        return builder
      }
    })
  }
}

const input = {
  eventId: 'evt-1',
  orderId: 'order-1',
  teamId: 'team-1',
  owner: 'Jos',
  actor: 'pass'
}

/** SQLite/D1 surface a unique violation with this in the message. */
function uniqueViolation() {
  return new Error('UNIQUE constraint failed: sales_handovers.teamId, sales_handovers.orderId')
}

describe('recordHandover', () => {
  it('records the handover on the first tap', async () => {
    const db = fakeDb(() => ({ rowsAffected: 1 }))

    const result = await recordHandover(db as any, input)

    expect(result.created).toBe(true)
    expect(db.inserted).toHaveLength(1)
  })

  it('writes the tenant and event alongside the order, so the row is scoped', async () => {
    const db = fakeDb(() => ({ rowsAffected: 1 }))

    await recordHandover(db as any, input)

    expect(db.inserted[0]).toMatchObject({
      eventId: 'evt-1',
      orderId: 'order-1',
      teamId: 'team-1'
    })
  })

  it('records who handed it over, so createdBy answers it without a second column', async () => {
    const db = fakeDb(() => ({ rowsAffected: 1 }))

    await recordHandover(db as any, input)

    expect(db.inserted[0]!.createdBy).toBe('pass')
  })

  it('treats a CONCURRENT double-tap as success, not a constraint error', async () => {
    // THE case this file exists for. A sequential-only test would pass against
    // a racy check-then-insert; this one will not.
    const db = fakeDb(() => uniqueViolation())

    const result = await recordHandover(db as any, input)

    expect(result.created).toBe(false)
  })

  it('does not reject when the conflict is absorbed by the database', async () => {
    // onConflictDoNothing path: no error, but nothing written either.
    const db = fakeDb(() => ({ rowsAffected: 0 }))

    await expect(recordHandover(db as any, input)).resolves.toMatchObject({ created: false })
  })

  it('leaves exactly one row after two taps', async () => {
    let calls = 0
    const db = fakeDb(() => (++calls === 1 ? { rowsAffected: 1 } : uniqueViolation()))

    const first = await recordHandover(db as any, input)
    const second = await recordHandover(db as any, input)

    expect([first.created, second.created]).toEqual([true, false])
    expect(db.inserted).toHaveLength(1)
  })

  it('survives both taps racing, with neither call rejecting', async () => {
    let calls = 0
    const db = fakeDb(() => (++calls === 1 ? { rowsAffected: 1 } : uniqueViolation()))

    const results = await Promise.all([
      recordHandover(db as any, input),
      recordHandover(db as any, input)
    ])

    expect(results.filter(r => r.created)).toHaveLength(1)
    expect(db.inserted).toHaveLength(1)
  })

  it('rethrows a failure that is NOT a uniqueness conflict', async () => {
    // Swallowing everything would lose real handovers silently and let the
    // outstanding count drift away from reality — the same class of bug as the
    // KDS board that kept serving a stale screen (#1766).
    const db = fakeDb(() => new Error('no such table: sales_handovers'))

    await expect(recordHandover(db as any, input)).rejects.toThrow(/no such table/)
  })
})
