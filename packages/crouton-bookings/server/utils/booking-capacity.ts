/**
 * Server-side booking capacity guard (#3379) — the ONE place every booking
 * write (cart checkout, generic POST, both PATCH routes) checks that a slot
 * or day still has room.
 *
 * Built on the pure rules in `app/utils/capacity` and `app/utils/full-day`;
 * since #4061 it counts free stock per product, per day, per slot.
 * The guard is a single SQL boolean with a FIXED number of bound parameters
 * (D1 allows 100), evaluated inside the same statement that writes the row, so
 * two requests racing for the last place cannot both win.
 *
 * Every write also resolves the booking's product (#4044, `resolveProduct`):
 * a booking always carries a product its own location lists.
 */
import { sql, eq, and, type SQL } from 'drizzle-orm'
import { bookingsBookings } from '../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../collections/locations/server/database/schema'
import { FULL_DAY_ID, fullDayConflict } from '../../app/utils/full-day'
import { parseLocationProducts } from '../../app/utils/capacity'

/** Columns the guard needs from a location row */
export const LOCATION_COLS = { id: bookingsLocations.id, teamId: bookingsLocations.teamId, slots: bookingsLocations.slots, offerFullDay: bookingsLocations.offerFullDay, products: bookingsLocations.products }

export interface GuardLocation {
  slots?: unknown
  offerFullDay?: boolean | number | null
  products?: unknown
}

export interface Selection {
  /** Slot ids to store — always a list; `['all-day']` at a location without slots (#4172) */
  slot: string[]
  /** How many units of the product — a whole number ≥ 1 (#4061) */
  quantity: number
  /** Slot ids the booking holds; `[all-day]` at a location without slots */
  slotIds: string[]
  /** Slot ids the guard checks: a full-day request at a slot location expands to every slot */
  guardIds: string[]
  /** The product this booking is for — always one the location lists (#4044) */
  product: string
}

export function parseSlots(slots: unknown): { id: string }[] {
  if (Array.isArray(slots)) return slots
  if (typeof slots === 'string') {
    try { const p = JSON.parse(slots); return Array.isArray(p) ? p : [] } catch { return [] }
  }
  return []
}

function bad(status: number, statusText: string): never {
  throw createError({ status, statusText })
}

/** A location's `products` list — the one parser, shared with the client (#4061) */
export const parseProducts = parseLocationProducts

/**
 * The product a booking at `location` is for (#4044): a named product must be
 * one the location lists; none named → the location's only product. Throws 400
 * when the location lists none, or two or more and none was named.
 */
export function resolveProduct(location: GuardLocation, productIn?: unknown): string {
  const list = parseProducts(location.products)
  if (list.length === 0) bad(400, 'Nothing to book at this location')
  if (productIn !== undefined && productIn !== null) {
    const id = String(productIn)
    if (!list.some(p => p.product === id)) bad(400, 'Unknown product')
    return id
  }
  if (list.length > 1) bad(400, 'Pick a product')
  return list[0]!.product
}

function toIdList(slotIdsIn: unknown): string[] {
  if (Array.isArray(slotIdsIn)) return slotIdsIn.map(String).filter(id => id !== 'inventory')
  if (typeof slotIdsIn === 'string' && slotIdsIn && slotIdsIn !== 'inventory') return [slotIdsIn]
  return []
}

function normaliseSlotIds(location: GuardLocation, slots: { id: string }[], slotIdsIn: unknown): string[] {
  const ids = toIdList(slotIdsIn)

  if (slots.length === 0) {
    if (ids.some(id => id !== FULL_DAY_ID)) bad(400, 'Unknown slot')
    return [FULL_DAY_ID]
  }
  if (ids.length === 0) bad(400, 'Pick a slot')
  const known = new Set(slots.map(s => s.id))
  if (location.offerFullDay) known.add(FULL_DAY_ID)
  if (ids.some(id => !known.has(id))) bad(400, 'Unknown slot')
  const unique = [...new Set(ids)]
  if (fullDayConflict(unique, [])) bad(400, 'The full day can\'t be combined with another slot')
  return unique
}

/** Normalise + validate what is being booked at `location`; throws 400. */
export function validateSelection(location: GuardLocation, slotIdsIn: unknown, quantityIn?: unknown, productIn?: unknown): Selection {
  const product = resolveProduct(location, productIn)
  const quantity = quantityIn ?? 1
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    bad(400, 'Quantity must be a whole number of at least 1')
  }

  const slots = parseSlots(location.slots)
  const ids = normaliseSlotIds(location, slots, slotIdsIn)
  const guardIds = slots.length === 0
    ? [FULL_DAY_ID]
    : ids.includes(FULL_DAY_ID) ? slots.map(s => s.id) : ids
  return { slot: ids, quantity, slotIds: ids, guardIds, product }
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
 * One SQL boolean: does the requested selection still fit on that day? (#4061)
 * For every slot in `guardIds`: the summed quantity of the same product (or
 * product NULL) held in that slot or the full day, plus the requested
 * quantity, must not exceed the product's stock — read from the location row
 * inside this statement, so a product unlisted meanwhile has stock 0 and is
 * refused. Fixed parameter count regardless of how many slots the location has.
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
  // coalesce(stock, 0) is load-bearing: `x > NULL` is NULL, which would let an unlisted product through
  return sql`NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(selection.guardIds)}) c WHERE
    coalesce((SELECT sum(max(coalesce(b.quantity, 1), 1)) FROM bookings_bookings b
              WHERE ${day} AND (b.product = ${selection.product} OR b.product IS NULL)
                AND (json_type(b.slot) = 'null' OR json_array_length(b.slot) = 0
                     OR EXISTS (SELECT 1 FROM json_each(b.slot) s WHERE s.value IN (c.value, ${FULL_DAY_ID})))), 0)
    + ${selection.quantity}
    > coalesce((SELECT json_extract(p.value, '$.stock') FROM bookings_locations l, json_each(l.products) p
                WHERE l.id = ${locationId} AND l.teamId = ${teamId} AND json_extract(p.value, '$.product') = ${selection.product}), 0))`
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
  /** The product this booking is for (#4044) */
  product: string
  by: string
  nowTs: number
}

/** INSERT that aborts (NOT NULL on slot) when the guard refuses. */
export function guardedInsert(row: NewRow, guard: SQL): SQL {
  return sql`INSERT INTO bookings_bookings (id, teamId, owner, "order", location, date, slot, "group", quantity, status, product, createdAt, updatedAt, createdBy, updatedBy)
    SELECT ${row.id}, ${row.teamId}, ${row.owner}, 0, ${row.location}, ${row.storedTs}, ${guardedSlotValue(guard, row.slot)}, ${row.group}, ${row.quantity}, ${row.status}, ${row.product}, ${row.nowTs}, ${row.nowTs}, ${row.by}, ${row.by}`
}

function isNotNull(e: any): boolean {
  return /NOT NULL constraint failed/i.test(String(e?.message ?? '')) || /NOT NULL constraint failed/i.test(String(e?.cause?.message ?? ''))
}

/**
 * Run statements all-or-nothing. A refused guard (NOT NULL on slot) becomes 409.
 * - D1: one raw `$client.batch` of bound statements (D1 batches are transactions).
 *   drizzle's `db.batch([db.run(sql)])` can't be used there: `db.run()` returns a
 *   `SQLiteRaw` with no `.stmt`, so the D1 session crashes on `stmt.bind` (#3968).
 * - libsql: one `db.batch`.
 * - better-sqlite3: one immediate transaction.
 */
export async function runAtomic(db: any, statements: SQL[], noRoomMessage = 'No room left'): Promise<void> {
  try {
    const client = db.$client
    if (typeof client?.prepare === 'function' && typeof client?.batch === 'function') {
      await client.batch(statements.map((s) => {
        const q = db.dialect.sqlToQuery(s)
        return client.prepare(q.sql).bind(...q.params)
      }))
    }
    else if (typeof db.batch === 'function') {
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

const PLAIN_KEYS = ['location', 'slot', 'group', 'quantity', 'status', 'product'] as const

type MoveCheck = { slotPatch: unknown, newRange: DayRange | null, curTs: number }

/** Does the patch send a location that differs from the stored one? */
function changesLocation(patch: { location?: string }, current: any): boolean {
  return patch.location !== undefined && patch.location !== current.location
}

/** Does the patch change where or for which product? */
function changesTarget(patch: { location?: string, product?: string | null }, current: any): boolean {
  if (changesLocation(patch, current)) return true
  return patch.product != null && patch.product !== current.product
}

/** Does the patch change when, which slot or how many? */
function changesWhenOrWhat(patch: { quantity?: number }, current: any, r: MoveCheck): boolean {
  if (r.newRange !== null && r.newRange.storedTs !== r.curTs) return true
  if (r.slotPatch !== undefined && !sameSlots(r.slotPatch, current.slot)) return true
  return patch.quantity !== undefined && patch.quantity !== current.quantity
}

/** Does the patch change what is booked (where, when, which slot, how many, which product)? */
function isMove(
  patch: { location?: string, quantity?: number, product?: string | null },
  current: any,
  r: MoveCheck,
): boolean {
  return changesTarget(patch, current) || changesWhenOrWhat(patch, current, r)
}

function mergeBooking(
  patch: { location?: string, quantity?: number, status?: string, group?: string | null },
  current: any,
  slotPatch: unknown,
  storedTs: number,
) {
  return {
    location: patch.location ?? current.location,
    slot: slotPatch ?? current.slot,
    quantity: patch.quantity ?? current.quantity,
    status: patch.status ?? current.status,
    group: patch.group === undefined ? current.group : patch.group,
    storedTs,
  }
}

function parsePatchDate(date: string | Date | null | undefined, tz: string): DayRange | null {
  if (date === undefined || date === null) return null
  const range = dayRange(date, tz)
  if (!range) throw createError({ status: 400, statusText: 'Invalid date' })
  return range
}

function toSlotPatch(slot: unknown): unknown[] | undefined {
  if (slot === undefined) return undefined
  return Array.isArray(slot) ? slot : [slot]
}

function plainSet(
  patch: Record<string, unknown>,
  r: { slotPatch: unknown, newRange: DayRange | null, userId: string, nowTs: number },
): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedBy: r.userId, updatedAt: new Date(r.nowTs * 1000) }
  for (const k of PLAIN_KEYS) {
    if (patch[k] !== undefined) set[k] = k === 'slot' ? r.slotPatch : patch[k]
  }
  if (r.newRange) set.date = new Date(r.newRange.storedTs * 1000)
  return set
}

type BookingPatch = { location?: string, date?: string | Date, slot?: unknown, group?: string | null, quantity?: number, status?: string, product?: string | null }

interface PatchArgs {
  teamId: string
  bookingId: string
  userId: string
  ownerId?: string
  patch: BookingPatch
  tz: string
}

/** The guard columns of a location of `teamId`; 404 when it isn't there. */
async function selectGuardLocation(db: any, locationId: string, teamId: string): Promise<GuardLocation & { id: string }> {
  const [location] = await db.select(LOCATION_COLS).from(bookingsLocations)
    .where(and(eq(bookingsLocations.id as any, locationId), eq(bookingsLocations.teamId as any, teamId)))
  if (!location) throw createError({ status: 404, statusText: 'Location not found' })
  return location
}

function bookingConds(o: PatchArgs): SQL[] {
  const b = bookingsBookings as any
  const conds = [eq(b.id, o.bookingId), eq(b.teamId, o.teamId)]
  if (o.ownerId) conds.push(eq(b.owner, o.ownerId))
  return conds
}

interface PatchState {
  patch: BookingPatch
  current: any
  conds: SQL[]
  slotPatch: unknown
  newRange: DayRange | null
  merged: ReturnType<typeof mergeBooking>
  nowTs: number
}

/** No capacity change: write the sent fields as they are (the product still belongs to the location). */
async function patchPlain(db: any, o: PatchArgs, s: PatchState): Promise<any> {
  const set = plainSet(s.patch, { slotPatch: s.slotPatch, newRange: s.newRange, userId: o.userId, nowTs: s.nowTs })
  // The stored product always belongs to the stored location (#4044)
  if (s.patch.product !== undefined || changesLocation(s.patch, s.current)) {
    const loc = await selectGuardLocation(db, s.merged.location, o.teamId)
    set.product = resolveProduct(loc, s.patch.product)
  }
  const [updated] = await db.update(bookingsBookings as any).set(set).where(and(...s.conds)).returning()
  return updated
}

/** A move or re-activation: one guarded UPDATE that re-checks capacity. */
async function patchMoved(db: any, o: PatchArgs, s: PatchState): Promise<any> {
  const { teamId, bookingId, userId, ownerId } = o
  const { merged } = s
  const location = await selectGuardLocation(db, merged.location, teamId)
  const range = dayRange(new Date(merged.storedTs * 1000), o.tz)!
  // The sent product; else the stored one, unless the location changes (#4044)
  const productIn = s.patch.product ?? (changesLocation(s.patch, s.current) ? undefined : s.current.product)
  // An old row stored with quantity < 1 moves as 1 unless the patch sends a different one (#4061)
  const keepsQty = s.patch.quantity === undefined || Number(s.patch.quantity) === Number(s.current.quantity)
  const quantity = keepsQty && !(Number(merged.quantity) >= 1) ? 1 : merged.quantity
  const selection = validateSelection(location, merged.slot, quantity, productIn)
  const guard = guardSql({ teamId, locationId: merged.location, range, selection, excludeId: bookingId })
  const ownerCond = ownerId ? sql` AND owner = ${ownerId}` : sql``
  const changed = await db.all(sql`UPDATE bookings_bookings SET location = ${merged.location}, date = ${merged.storedTs}, slot = ${JSON.stringify(selection.slot ?? null)}, quantity = ${selection.quantity}, status = ${merged.status}, "group" = ${merged.group}, product = ${selection.product}, updatedBy = ${userId}, updatedAt = ${s.nowTs}
    WHERE id = ${bookingId} AND teamId = ${teamId}${ownerCond} AND ${guard} RETURNING id`) as { id: string }[]
  if (changed.length === 0) throw createError({ status: 409, statusText: 'No room left for that booking' })
  const [updated] = await db.select().from(bookingsBookings as any).where(eq((bookingsBookings as any).id, bookingId))
  return updated
}

/**
 * Patch a booking, re-checking capacity when it moves or comes back from
 * cancelled. `ownerId` restricts the row to its owner (non-admin callers).
 */
export async function patchBookingGuarded(db: any, o: PatchArgs): Promise<any> {
  // `product` null or absent means "not sent" (#4044)
  const patch = { ...o.patch, product: o.patch.product ?? undefined }
  const conds = bookingConds(o)
  const [current] = await db.select().from(bookingsBookings as any).where(and(...conds))
  if (!current) throw createError({ status: 404, statusText: 'Booking not found or unauthorized' })

  const slotPatch = toSlotPatch(patch.slot)
  const curTs = Math.floor(new Date(current.date).getTime() / 1000)
  const newRange = parsePatchDate(patch.date, o.tz)
  const moved = isMove(patch, current, { slotPatch, newRange, curTs })
  const merged = mergeBooking(patch, current, slotPatch, newRange?.storedTs ?? curTs)
  const reactivated = current.status === 'cancelled' && merged.status !== 'cancelled'
  const state: PatchState = { patch, current, conds, slotPatch, newRange, merged, nowTs: Math.floor(Date.now() / 1000) }

  const plain = !(moved || reactivated) || merged.status === 'cancelled'
  return plain ? patchPlain(db, o, state) : patchMoved(db, o, state)
}
