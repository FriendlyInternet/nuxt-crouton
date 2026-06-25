/**
 * DEV-ONLY seed route for the with-sales e2e fixture (#355).
 *
 * The CLI `crouton-seed` writes via `wrangler d1` into the wrangler-D1 local
 * store, but a booted fixture serves from NuxtHub's `.data/db/sqlite.db` — a
 * DIFFERENT database. So instead of the CLI, this route reuses the SAME
 * declarative sales seed provider (`@fyit/crouton-sales/seed`) via
 * `collectSeedSql` from `@fyit/crouton-core/shared/seed`, then executes the
 * generated idempotent SQL against the LIVE db the app actually reads
 * (`useDB()`), so the seeded event/products are visible to the order endpoints.
 *
 * On top of the provider's catalog (event `vlaamsekermis`, helper PIN `1234`,
 * categories + 5 products) it inserts the two rows the provider deliberately
 * does NOT create but #355 needs to exercise the print path end to end:
 *   - one `sales_locations` row (a kitchen printer's required location), and
 *   - one kitchen `sales_printers` row pointing at the printer transport the
 *     spec passes in (`printerIp` / `printerPort` — the in-test fake :9100
 *     server). The seed products carry no location, so they route to the
 *     "default" kitchen ticket on this printer (see generatePrintJobsForOrder).
 *
 * Gated to dev (`import.meta.dev`) so it can never ship in a real build.
 *
 * Body: `{ teamId, teamSlug, printerIp?, printerPort? }`
 * Returns: `{ eventId, printerId, locationId, productIds }` so the spec can
 * place orders + override the printer target without guessing ids.
 */
import { sql } from 'drizzle-orm'
import { provider as salesSeedProvider } from '@fyit/crouton-sales/seed'
import { collectSeedSql, seedId } from '@fyit/crouton-core/shared/seed'

interface SeedBody {
  teamId: string
  teamSlug: string
  /** Fake-printer transport the spec stands up; defaults to a black-hole address. */
  printerIp?: string
  printerPort?: number
}

const EVENT_SLUG = 'vlaamsekermis'

export default defineEventHandler(async (event) => {
  // Hard dev gate — this route must never exist in a real deployment.
  if (!import.meta.dev) {
    throw createError({ status: 404, statusText: 'Not found' })
  }

  const body = await readBody<SeedBody>(event)
  if (!body?.teamId || !body?.teamSlug) {
    throw createError({ status: 400, statusText: 'teamId and teamSlug are required' })
  }

  const db = useDB()

  // 1. Build the declarative sales catalog SQL (event + categories + products)
  //    from the package's own seed provider — same rows the CLI seeds, but run
  //    against the live NuxtHub DB the app reads.
  const seedSql = await collectSeedSql({
    providers: [salesSeedProvider],
    teamSlug: body.teamSlug,
    teamId: body.teamId,
    locale: 'nl'
  })

  // Each upsert is one line ending in `;` (JSON payloads are single-line), so
  // splitting on newlines yields one statement per row.
  const statements = seedSql
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  for (const statement of statements) {
    await db.run(sql.raw(statement))
  }

  // 2. The provider doesn't create a printer; #355 needs one. Insert a kitchen
  //    location + a kitchen printer pointed at the fake :9100 server. Stable
  //    seed ids keep the whole route idempotent (re-seeding upserts in place).
  const eventId = seedId('event', body.teamSlug, EVENT_SLUG)
  const locationId = seedId('loc', body.teamSlug, EVENT_SLUG, 'kitchen')
  const printerId = seedId('prn', body.teamSlug, EVENT_SLUG, 'kitchen')
  const now = Math.floor(Date.now() / 1000)
  const printerIp = body.printerIp ?? '127.0.0.1'
  const printerPort = body.printerPort ?? 9100

  await db.run(sql`
    INSERT INTO "sales_locations"
      ("id", "teamId", "owner", "eventId", "title",
       "createdAt", "updatedAt", "createdBy", "updatedBy")
    VALUES
      (${locationId}, ${body.teamId}, 'seed', ${eventId}, 'Keuken',
       ${now}, ${now}, 'seed', 'seed')
    ON CONFLICT("id") DO UPDATE SET "eventId" = excluded."eventId", "title" = excluded."title"
  `)

  await db.run(sql`
    INSERT INTO "sales_printers"
      ("id", "teamId", "owner", "eventId", "locationId", "title",
       "ipAddress", "port", "status", "type", "driver",
       "showPrices", "isActive",
       "createdAt", "updatedAt", "createdBy", "updatedBy")
    VALUES
      (${printerId}, ${body.teamId}, 'seed', ${eventId}, ${locationId}, 'Keuken Printer',
       ${printerIp}, ${String(printerPort)}, 'idle', 'kitchen', 'network-escpos',
       1, 1,
       ${now}, ${now}, 'seed', 'seed')
    ON CONFLICT("id") DO UPDATE SET
      "ipAddress" = excluded."ipAddress",
      "port" = excluded."port",
      "eventId" = excluded."eventId",
      "locationId" = excluded."locationId"
  `)

  // 3. Read back the products so the spec can place an order with a real product.
  //    `db.all` (libsql drizzle) returns an array of row objects directly.
  const rows = (await db.all(sql`
    SELECT "id" AS id, "price" AS price FROM "sales_products" WHERE "eventId" = ${eventId}
  `)) as Array<{ id: string, price: number }>

  return {
    eventId,
    printerId,
    locationId,
    products: rows.map(r => ({ id: r.id, price: r.price })),
    productIds: rows.map(r => r.id)
  }
})
