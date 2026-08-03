/**
 * @crouton-package crouton-sales
 * @description Pure planning for the product paste-import (#1656, epic #1652).
 *
 * Decides WHAT the import will write — which rows survive, which are reported as errors,
 * which duplicates are skipped, and which categories/locations have to be created first —
 * without touching the DB, the clock, or an id generator. The endpoint stays a thin
 * fetch → plan → insert delegate.
 *
 * Same split as `order-filters.ts` / `my-orders-shape.ts` / `delete-event-orders.ts`:
 * the branchy part is pure and unit-tested (`test/plan-product-import.test.ts`), so the
 * handler carries no logic worth testing through Nitro.
 */
import type { ParsedProductRow, RelationToCreate } from '../../app/utils/parse-product-paste'

export interface TitleRow { id: string, title: string }
export interface ImportError { rowIndex: number, message: string }

export interface ImportPlan {
  /** Rows that will become products. */
  toCreate: ParsedProductRow[]
  /** Rows the parser rejected, reported back to the modal. */
  errors: ImportError[]
  /** Count of duplicate rows the user did not opt into. */
  skipped: number
  /** Category titles that don't exist on this event yet, in first-seen spelling. */
  newCategoryTitles: string[]
  /** Location titles that don't exist on this event yet, in first-seen spelling. */
  newLocationTitles: string[]
}

/** Trimmed, case-insensitive key — the same normalization the parser uses. */
export const norm = (v: string) => v.trim().toLowerCase()

/**
 * Normalize the untrusted request body. Returns an empty `paste` when the field is
 * missing/blank/not-a-string, so the handler's only job is to turn that into a 400.
 * Non-integer row indexes are dropped rather than trusted.
 */
export function readImportRequest(body: unknown): { paste: string, optIn: Set<number> } {
  const b = (body ?? {}) as { paste?: unknown, createDuplicateRowIndexes?: unknown }
  const paste = typeof b.paste === 'string' && b.paste.trim() ? b.paste : ''
  const raw = Array.isArray(b.createDuplicateRowIndexes) ? b.createDuplicateRowIndexes : []
  return { paste, optIn: new Set(raw.filter((n: unknown): n is number => Number.isInteger(n))) }
}

/** Append after the event's current highest `order`; an empty event starts at 0. */
export function nextOrderAfter(rows: Array<{ maxOrder: number | null }>): number {
  return (rows[0]?.maxOrder ?? -1) + 1
}

/** Map every known title → id, so products can resolve their relations by name. */
export function indexByTitle(rows: TitleRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of rows) map.set(norm(r.title), r.id)
  return map
}

/**
 * A row the parser rejected is reported and dropped — it must never abort the batch for
 * the good rows. A duplicate is only written when the user explicitly ticked that row.
 */
export function planProductImport(input: {
  rows: ParsedProductRow[]
  relationsToCreate: RelationToCreate[]
  optIn: Set<number>
  existingCategories: TitleRow[]
  existingLocations: TitleRow[]
}): ImportPlan {
  const errors: ImportError[] = []
  const toCreate: ParsedProductRow[] = []
  let skipped = 0

  for (const row of input.rows) {
    if (row.status === 'error') errors.push({ rowIndex: row.rowIndex, message: row.error ?? 'Invalid row' })
    else if (row.status === 'warn-duplicate' && !input.optIn.has(row.rowIndex)) skipped++
    else toCreate.push(row)
  }

  // Derived from the re-parse's relation list, filtered against what the DB really has —
  // never from the client's own `relationsToCreate`, which a payload could inflate.
  const knownCategories = indexByTitle(input.existingCategories)
  const knownLocations = indexByTitle(input.existingLocations)
  const newCategoryTitles = input.relationsToCreate
    .filter(r => r.kind === 'category' && !knownCategories.has(norm(r.title)))
    .map(r => r.title)
  const newLocationTitles = input.relationsToCreate
    .filter(r => r.kind === 'location' && !knownLocations.has(norm(r.title)))
    .map(r => r.title)

  return { toCreate, errors, skipped, newCategoryTitles, newLocationTitles }
}

/**
 * Cloudflare D1 caps a query at 100 BOUND PARAMETERS, and a multi-row INSERT binds one per
 * column per row — so the ceiling is on `rows × columns`, not on rows. Writing a whole
 * import in one statement 500'd on staging at 43 products × 17 columns = 731 parameters,
 * while passing locally where SQLite allows 32 766 (#1707).
 *
 * https://developers.cloudflare.com/d1/platform/limits/
 *
 * Chunk size is DERIVED from the row's own shape rather than hardcoded, so it stays correct
 * when a collection gains a column (the failure mode is silent: a wider row just fits fewer
 * per statement). A row too wide to ever fit still yields one row per statement — a chunk
 * size of 0 would loop forever.
 */
export const D1_MAX_BOUND_PARAMS = 100

export function chunkForBoundParams<T extends Record<string, unknown>>(
  rows: T[],
  maxParams = D1_MAX_BOUND_PARAMS,
): T[][] {
  if (!rows.length) return []
  const columns = Math.max(Object.keys(rows[0] as object).length, 1)
  const size = Math.max(Math.floor(maxParams / columns), 1)
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
  return chunks
}

/**
 * Turn planned rows into insertable product values. `order` continues after the event's
 * current highest so an import lands at the end of the list instead of colliding with
 * existing positions. Ids and timestamps are injected so this stays pure.
 */
export function buildProductValues(
  toCreate: ParsedProductRow[],
  ids: { categories: Map<string, string>, locations: Map<string, string> },
  ctx: {
    eventId: string
    stamp: { teamId: string, owner: string, createdBy: string, updatedBy: string }
    now: Date
    startOrder: number
    newId: () => string
  },
) {
  return toCreate.map((row, i) => ({
    id: ctx.newId(),
    ...ctx.stamp,
    order: ctx.startOrder + i,
    eventId: ctx.eventId,
    categoryId: row.categoryTitle ? (ids.categories.get(norm(row.categoryTitle)) ?? null) : null,
    locationId: row.locationTitle ? (ids.locations.get(norm(row.locationTitle)) ?? null) : null,
    title: row.title as string,
    description: row.description ?? null,
    price: row.price as number,
    isActive: row.isActive ?? true,
    requiresRemark: row.requiresRemark ?? false,
    remarkPrompt: row.remarkPrompt ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }))
}
