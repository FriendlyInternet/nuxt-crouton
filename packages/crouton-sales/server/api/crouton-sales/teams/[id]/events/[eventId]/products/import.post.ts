/**
 * Bulk paste-import of products (#1656, epic #1652).
 *
 * Receives the batch the user confirmed in the import modal (#1657) and writes it:
 * missing categories/locations first, then the products, all scoped to this event.
 *
 * THE LOAD-BEARING RULE: the client's parse is treated as a *hint*, never as truth.
 * The raw pasted text is re-run through the same pure parser the modal used
 * (`parseProductPaste`, #1655) and the result of THAT is what gets written — so a
 * tampered, stale, or hand-rolled payload cannot smuggle in a row the parser would
 * have rejected, nor a field this import is not allowed to set.
 *
 * `id`, `eventId`, `teamId`, `options`, `hasOptions` and `multipleOptionsAllowed` are
 * never read off the payload: the first three come from the route + session, and the
 * option fields are deliberately out of scope for a flat paste (epic decision).
 *
 * The branchy part is the pure, unit-tested `server/utils/plan-product-import.ts`
 * (same split as `order-filters.ts` / `my-orders-shape.ts`); this handler is the
 * fetch → plan → insert delegate.
 */
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { requireTeamEvent } from '../../../../../../../utils/team-event'
import { parseProductPaste } from '../../../../../../../../app/utils/parse-product-paste'
import {
  planProductImport,
  buildProductValues,
  indexByTitle,
  readImportRequest,
  nextOrderAfter,
  norm,
  type TitleRow,
} from '../../../../../../../utils/plan-product-import'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { salesCategories } from '~~/layers/sales/collections/categories/server/database/schema'
import { salesLocations } from '~~/layers/sales/collections/locations/server/database/schema'

/**
 * Insert freshly-minted relation rows (if any) and fold their ids into the lookup the
 * products resolve against, so a product can point at a category created moments ago.
 */
async function insertAndIndex(
  db: ReturnType<typeof useDB>,
  table: typeof salesCategories | typeof salesLocations,
  rows: Array<{ id: string, title: string }>,
  index: Map<string, string>,
): Promise<void> {
  if (!rows.length) return
  await db.insert(table).values(rows as never)
  for (const row of rows) index.set(norm(row.title), row.id)
}

/**
 * Body: `{ paste: string, createDuplicateRowIndexes?: number[] }` — the raw clipboard text
 * (re-parsed here; it is the source of truth) plus the 1-based row indexes the user ticked
 * to create despite a duplicate warning. Normalized by `readImportRequest`.
 */
export default defineEventHandler(async (event) => {
  const { team, user, db, eventId } = await requireTeamEvent(event)

  const { paste, optIn } = readImportRequest(await readBody(event))
  if (!paste) {
    throw createError({ status: 400, statusText: 'A non-empty paste is required' })
  }

  // Current state of the event, so the re-parse flags duplicates and unknown relations
  // against what is really in the DB right now — not against the snapshot the browser
  // held when the user hit paste.
  const [existingProducts, existingCategories, existingLocations] = await Promise.all([
    db.select({ id: salesProducts.id, title: salesProducts.title })
      .from(salesProducts).where(eq(salesProducts.eventId, eventId)),
    db.select({ id: salesCategories.id, title: salesCategories.title })
      .from(salesCategories).where(eq(salesCategories.eventId, eventId)),
    db.select({ id: salesLocations.id, title: salesLocations.title })
      .from(salesLocations).where(eq(salesLocations.eventId, eventId)),
  ]) as [TitleRow[], TitleRow[], TitleRow[]]

  const parsed = parseProductPaste(paste, {
    existingProductTitles: existingProducts.map(p => p.title),
    existingCategoryTitles: existingCategories.map(c => c.title),
    existingLocationTitles: existingLocations.map(l => l.title),
  })

  const plan = planProductImport({
    rows: parsed.rows,
    relationsToCreate: parsed.relationsToCreate,
    optIn,
    existingCategories,
    existingLocations,
  })

  const now = new Date()
  const stamp = { teamId: team.id, owner: user.id, createdBy: user.id, updatedBy: user.id }

  // 1. Relations first, so every product has an id to point at.
  const newCategories = plan.newCategoryTitles.map(title => ({
    id: nanoid(), eventId, title, displayOrder: 0, ...stamp, createdAt: now, updatedAt: now,
  }))
  const newLocations = plan.newLocationTitles.map(title => ({
    id: nanoid(), eventId, title, ...stamp, createdAt: now, updatedAt: now,
  }))

  const categoryIds = indexByTitle(existingCategories)
  const locationIds = indexByTitle(existingLocations)

  await insertAndIndex(db, salesCategories, newCategories, categoryIds)
  await insertAndIndex(db, salesLocations, newLocations, locationIds)

  // 2. Products, appended after the event's current highest `order`.
  const highest = await db
    .select({ maxOrder: salesProducts.order })
    .from(salesProducts)
    .where(eq(salesProducts.eventId, eventId))
    .orderBy(desc(salesProducts.order))
    .limit(1)

  const productRows = buildProductValues(
    plan.toCreate,
    { categories: categoryIds, locations: locationIds },
    {
      eventId,
      stamp,
      now,
      startOrder: nextOrderAfter(highest as Array<{ maxOrder: number | null }>),
      newId: nanoid,
    },
  )

  if (productRows.length) {
    await db.insert(salesProducts).values(productRows)
  }

  return {
    created: productRows.length,
    skipped: plan.skipped,
    errors: plan.errors,
    createdCategories: newCategories.map(c => c.title),
    createdLocations: newLocations.map(l => l.title),
  }
})
