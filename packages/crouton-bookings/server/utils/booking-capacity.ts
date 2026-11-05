/**
 * Server-side booking capacity guard (#3379) — the ONE place every booking
 * write (cart checkout, generic POST, both PATCH routes) checks that a slot
 * or day still has room.
 *
 * Built on the pure rules in `app/utils/capacity` and `app/utils/full-day`.
 * The guard is a single SQL boolean with a FIXED number of bound parameters
 * (D1 allows 100), evaluated inside the same statement that writes the row, so
 * two requests racing for the last place cannot both win.
 */
import { sql, eq, and, type SQL } from 'drizzle-orm'
import { bookingsBookings } from '../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../collections/locations/server/database/schema'
import { FULL_DAY_ID, fullDayConflict } from '../../app/utils/full-day'
import { capacityPlan, type CapacityPlan } from '../../app/utils/capacity'

/** Columns the guard needs from a location row */
export const LOCATION_COLS = { id: bookingsLocations.id, teamId: bookingsLocations.teamId, inventoryMode: bookingsLocations.inventoryMode, quantity: bookingsLocations.quantity, slots: bookingsLocations.slots, offerFullDay: bookingsLocations.offerFullDay }

export interface GuardLocation {
  inventoryMode?: boolean | number | null
  quantity?: number | null
  slots?: unknown
  offerFullDay?: boolean | number | null
}

export interface Selection {
  /** Slot ids to store; `null` for inventory (stored as JSON null) */
  slot: string[] | null
  quantity: number
  /** What the capacity plan must check */
  slotIds: string[]
  plan: CapacityPlan
  inventory: boolean
}

export function parseSlots(slots: unknown): { id: string, capacity?: number | null }[] {
  if (Array.isArray(slots)) return slots
  if (typeof slots === 'string') {
    try { const p = JSON.parse(slots); return Array.isArray(p) ? p : [] } catch { return [] }
  }
  return []
}

function bad(status: number, statusText: string): never {
  throw createError({ status, statusText })
}

/** Normalise + validate what is being booked at `location`; throws 400. */
export function validateSelection(location: GuardLocation, slotIdsIn: unknown, quantityIn?: unknown): Selection {
  const slots = parseSlots(location.slots)
  const inventory = !!location.inventoryMode
  const plan = capacityPlan({ inventoryMode: inventory, quantity: location.quantity, slots }, [])

  if (inventory) {
    const q = quantityIn ?? 1
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1) {
      bad(400, 'Quantity must be a whole number of at least 1')
    }
    return { slot: null, quantity: q, slotIds: [], plan, inventory: true }
  }

  let ids: string[] = Array.isArray(slotIdsIn) ? (slotIdsIn as unknown[]).map(String) : (typeof slotIdsIn === 'string' && slotIdsIn ? [slotIdsIn] : [])
  ids = ids.filter(id => id !== 'inventory')

  if (slots.length === 0) {
    if (ids.some(id => id !== FULL_DAY_ID)) bad(400, 'Unknown slot')
    ids = [FULL_DAY_ID]
  }
  else {
    if (ids.length === 0) bad(400, 'Pick a slot')
    const known = new Set(slots.map(s => s.id))
    if (location.offerFullDay) known.add(FULL_DAY_ID)
    if (ids.some(id => !known.has(id))) bad(400, 'Unknown slot')
    ids = [...new Set(ids)]
    if (fullDayConflict(ids, [])) bad(400, 'The full day can\'t be combined with another slot')
  }
  return {
    slot: ids,
    quantity: 1,
    slotIds: ids,
    plan: capacityPlan({ inventoryMode: false, quantity: location.quantity, slots }, ids),
    inventory: false,
  }
}

// --- timezone-aware day maths ---

// Offset (ms) of `tz` from UTC at the instant `ms`
function tzOffsetMs(ms: number, tz: string): number {
  const p: Record<string, number> = {}
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) {
    if (x.type !== 'literal') p[x.type] = Number(x.value)
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(ms / 1000) * 1000
}

// UTC instant (ms) at which calendar day y-m-d begins in `tz`
export function dayStartMs(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d)
  const first = guess - tzOffsetMs(guess, tz)
  return guess - tzOffsetMs(first, tz)
}

export interface DayRange { storedTs: number, dayStartTs: number, dayEndTs: number }

/**
 * Resolve the day being booked. A plain `YYYY-MM-DD` is stored as midnight of
 * that day in the booking timezone; an ISO string / Date is stored as sent.
 * Returns null when the input isn't a date.
 */
export function dayRange(input: string | Date | number, tz: string): DayRange | null {
  let storedMs: number
  const plain = typeof input === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input) : null
  if (plain) storedMs = dayStartMs(Number(plain[1]), Number(plain[2]), Number(plain[3]), tz)
  else storedMs = new Date(input).getTime()
  if (Number.isNaN(storedMs)) return null

  const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(storedMs))
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return {
    storedTs: Math.floor(storedMs / 1000),
    dayStartTs: Math.floor(dayStartMs(y, m, d, tz) / 1000),
    dayEndTs: Math.floor(dayStartMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz) / 1000),
  }
}

/**
 * One SQL boolean: does the requested selection still fit on that day?
 * Fixed parameter count regardless of how many slots the location has.
 */
export function guardSql(o: {
  teamId: string
  locationId: string
  range: DayRange
  selection: Selection
  excludeId?: string
}): SQL {
  const { teamId, locationId, range, selection, excludeId } = o
  const day = sql`b.teamId = ${teamId} AND b.location = ${locationId} AND b.date >= ${range.dayStartTs} AND b.date < ${range.dayEndTs} AND b.status <> 'cancelled'${excludeId ? sql` AND b.id <> ${excludeId}` : sql``}`
  const { plan } = selection
  const guards: SQL[] = []

  if (plan.kind === 'inventory') {
    guards.push(sql`(SELECT coalesce(sum(b.quantity), 0) FROM bookings_bookings b WHERE ${day}) + ${selection.quantity} <= ${plan.cap}`)
    return sql.join(guards, sql` AND `)
  }

  const named = plan.checks.filter(c => c.slotId !== null)
  for (const c of plan.checks.filter(c => c.slotId === null)) {
    guards.push(sql`(SELECT count(*) FROM bookings_bookings b WHERE ${day}) < ${c.cap}`)
  }
  if (named.length > 0) {
    guards.push(sql`NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(named)}) c WHERE (SELECT count(*) FROM bookings_bookings b WHERE ${day} AND EXISTS (SELECT 1 FROM json_each(b.slot) s WHERE s.value IN (json_extract(c.value, '$.slotId'), ${FULL_DAY_ID}))) >= json_extract(c.value, '$.cap'))`)
  }
  // full-day is exclusive (#2261), also under concurrent requests
  if (selection.slotIds.includes(FULL_DAY_ID)) {
    guards.push(sql`NOT EXISTS (SELECT 1 FROM bookings_bookings b WHERE ${day})`)
  }
  else if (selection.slotIds.length > 0) {
    guards.push(sql`NOT EXISTS (SELECT 1 FROM bookings_bookings b WHERE ${day} AND EXISTS (SELECT 1 FROM json_each(b.slot) s WHERE s.value = ${FULL_DAY_ID}))`)
  }
  return sql.join(guards, sql` AND `)
}

/** The slot column is NOT NULL JSON; a guarded row is written as NULL when refused. */
export function guardedSlotValue(guard: SQL, slot: string[] | null): SQL {
  return sql`CASE WHEN ${guard} THEN ${JSON.stringify(slot ?? null)} ELSE NULL END`
}

export interface NewRow {
  id: string
  teamId: string
  owner: string
  location: string
  storedTs: number
  slot: string[] | null
  group: string | null
  quantity: number
  status: string
  by: string
  nowTs: number
}

/** INSERT that aborts (NOT NULL on slot) when the guard refuses. */
export function guardedInsert(row: NewRow, guard: SQL): SQL {
  return sql`INSERT INTO bookings_bookings (id, teamId, owner, "order", location, date, slot, "group", quantity, status, createdAt, updatedAt, createdBy, updatedBy)
    SELECT ${row.id}, ${row.teamId}, ${row.owner}, 0, ${row.location}, ${row.storedTs}, ${guardedSlotValue(guard, row.slot)}, ${row.group}, ${row.quantity}, ${row.status}, ${row.nowTs}, ${row.nowTs}, ${row.by}, ${row.by}`
}

function isNotNull(e: any): boolean {
  return /NOT NULL constraint failed/i.test(String(e?.message ?? '')) || /NOT NULL constraint failed/i.test(String(e?.cause?.message ?? ''))
}

/**
 * Run statements all-or-nothing. D1/libsql: one `db.batch`; better-sqlite3: one
 * transaction. A refused guard (NOT NULL on slot) becomes 409.
 */
export async function runAtomic(db: any, statements: SQL[], noRoomMessage = 'No room left'): Promise<void> {
  try {
    if (typeof db.batch === 'function') {
      await db.batch(statements.map(s => db.run(s)))
    }
    else {
      db.transaction((tx: any) => { for (const s of statements) tx.run(s) }, { behavior: 'immediate' })
    }
  }
  catch (e) {
    if (isNotNull(e)) throw createError({ status: 409, statusText: noRoomMessage })
    throw e
  }
}

const sameSlots = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Patch a booking, re-checking capacity when it moves or comes back from
 * cancelled. `ownerId` restricts the row to its owner (non-admin callers).
 */
export async function patchBookingGuarded(db: any, o: {
  teamId: string
  bookingId: string
  userId: string
  ownerId?: string
  patch: { location?: string, date?: string | Date, slot?: unknown, group?: string | null, quantity?: number, status?: string }
  tz: string
}): Promise<any> {
  const { teamId, bookingId, userId, ownerId, patch, tz } = o
  const tables = { bookings: bookingsBookings as any, locations: bookingsLocations as any }
  const conds = [eq(tables.bookings.id, bookingId), eq(tables.bookings.teamId, teamId)]
  if (ownerId) conds.push(eq(tables.bookings.owner, ownerId))
  const [current] = await db.select().from(tables.bookings).where(and(...conds))
  if (!current) throw createError({ status: 404, statusText: 'Booking not found or unauthorized' })

  const slotPatch = patch.slot === undefined ? undefined : (Array.isArray(patch.slot) ? patch.slot : [patch.slot])
  const curTs = Math.floor(new Date(current.date).getTime() / 1000)
  const newRange = patch.date !== undefined && patch.date !== null ? dayRange(patch.date, tz) : null
  if (patch.date !== undefined && patch.date !== null && !newRange) throw createError({ status: 400, statusText: 'Invalid date' })

  const moved = (patch.location !== undefined && patch.location !== current.location)
    || (newRange !== null && newRange.storedTs !== curTs)
    || (slotPatch !== undefined && !sameSlots(slotPatch, current.slot))
    || (patch.quantity !== undefined && patch.quantity !== current.quantity)
  const merged = {
    location: patch.location ?? current.location,
    slot: slotPatch ?? current.slot,
    quantity: patch.quantity ?? current.quantity,
    status: patch.status ?? current.status,
    group: patch.group === undefined ? current.group : patch.group,
    storedTs: newRange?.storedTs ?? curTs,
  }
  const reactivated = current.status === 'cancelled' && merged.status !== 'cancelled'
  const nowTs = Math.floor(Date.now() / 1000)

  if (!(moved || reactivated) || merged.status === 'cancelled') {
    const set: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date(nowTs * 1000) }
    for (const k of ['location', 'slot', 'group', 'quantity', 'status'] as const) {
      if (patch[k] !== undefined) set[k] = k === 'slot' ? slotPatch : patch[k]
    }
    if (newRange) set.date = new Date(newRange.storedTs * 1000)
    const [updated] = await db.update(tables.bookings).set(set).where(and(...conds)).returning()
    return updated
  }

  const [location] = await db.select(LOCATION_COLS).from(tables.locations)
    .where(and(eq(tables.locations.id, merged.location), eq(tables.locations.teamId, teamId)))
  if (!location) throw createError({ status: 404, statusText: 'Location not found' })
  const range = dayRange(new Date(merged.storedTs * 1000), tz)!
  const selection = validateSelection(location, merged.slot, merged.quantity)
  const guard = guardSql({ teamId, locationId: merged.location, range, selection, excludeId: bookingId })
  const ownerCond = ownerId ? sql` AND owner = ${ownerId}` : sql``
  const changed = await db.all(sql`UPDATE bookings_bookings SET location = ${merged.location}, date = ${merged.storedTs}, slot = ${JSON.stringify(selection.slot ?? null)}, quantity = ${selection.quantity}, status = ${merged.status}, "group" = ${merged.group}, updatedBy = ${userId}, updatedAt = ${nowTs}
    WHERE id = ${bookingId} AND teamId = ${teamId}${ownerCond} AND ${guard} RETURNING id`) as { id: string }[]
  if (changed.length === 0) throw createError({ status: 409, statusText: 'No room left for that booking' })
  const [updated] = await db.select().from(tables.bookings).where(eq(tables.bookings.id, bookingId))
  return updated
}
