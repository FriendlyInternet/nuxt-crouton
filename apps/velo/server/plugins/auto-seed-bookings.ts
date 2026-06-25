/**
 * Auto-seed the demo content when a *demo* book is created (#849).
 *
 * Creating a book through the Velo UI emits the auth `crouton:operation` event
 * `auth:team:created` (fire-and-forget, from `afterCreateOrganization`). This
 * plugin listens for it and — ONLY for demo books — runs the shared
 * `@fyit/crouton-bookings` + `@fyit/crouton-pages` seed providers against the
 * live D1, hung off the real newly-created team, so the calendar/list AND the
 * public pages open populated instead of empty.
 *
 * Gating: the team slug must end with `-demo`. This is environment-independent
 * and explicit — a real customer book (e.g. `school-velotek`) is never touched,
 * even on production. The event payload carries no slug, so we look it up from
 * the `organization` table by `teamId`.
 *
 * Transport: the CLI seeder (`crouton-seed`) shells out to `wrangler d1`, which
 * isn't available at runtime in a Worker. Instead we reuse the public seed API
 * (`collectSeedSql`) to build the idempotent SQL and execute each statement
 * against the live drizzle D1 binding. `collectSeedSql` joins statements with
 * newlines and every upsert is a single line (JSON values are escaped, never
 * literal newlines), so splitting on `\n` yields one statement per line.
 *
 * Non-blocking: wrapped in try/catch and never throws — a seed failure must not
 * surface into team creation. Idempotent — the provider's stable `seedId`s mean
 * a re-fire upserts in place.
 */
import { defineNitroPlugin } from 'nitropack/runtime'
import { sql, eq } from 'drizzle-orm'
import { collectSeedSql } from '@fyit/crouton-core/shared/seed'
import { provider as bookingsProvider } from '@fyit/crouton-bookings/seed'
import { provider as pagesProvider, createPageWithBlocks } from '@fyit/crouton-pages/seed'
import { organization } from '~~/server/db/schema'

/** Demo books are explicitly named with a `-demo` slug suffix. */
function isDemoSlug(slug: string): boolean {
  return slug.endsWith('-demo')
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('crouton:operation', async (payload: any) => {
    if (payload?.type !== 'auth:team:created' || !payload.teamId) return

    try {
      const db = useDB()

      // The event payload has no slug — resolve it from the org row.
      const [org] = await db
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, payload.teamId))
        .limit(1)

      const slug = org?.slug
      if (!slug || !isDemoSlug(slug)) return

      // Build the demo SQL bound to the REAL team (not a synthetic seed org)
      // and execute it statement-by-statement against the live D1. Pages'
      // `createPageWithBlocks` is injected so block-contributing providers can
      // also seed a demo page (and the pages provider seeds its own demo page).
      const seedSql = await collectSeedSql({
        providers: [bookingsProvider, pagesProvider],
        teamId: payload.teamId,
        teamSlug: slug,
        locale: 'nl',
        createPageWithBlocks
      })

      const statements = seedSql
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)

      for (const statement of statements) {
        await db.run(sql.raw(statement))
      }

      console.log(`[velo/auto-seed] Seeded demo content for "${slug}" (${statements.length} statements)`)
    }
    catch (err) {
      // Non-blocking: a seed failure must never break team creation.
      console.error('[velo/auto-seed] Failed to auto-seed demo content:', err)
    }
  })
})
