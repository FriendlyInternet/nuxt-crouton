/**
 * One generic, idempotent pass (per Worker isolate, on first request): every
 * page lacking a `fr` translation gets one, so existing staging pages (e.g. the
 * seeded "Welkom") satisfy the `fr` default locale. See ../utils/fr-translations.
 * Non-blocking — a failure is logged, never thrown.
 */
import { defineNitroPlugin } from 'nitropack/runtime'
import { eq } from 'drizzle-orm'
import { pagesPages } from '@fyit/crouton-pages/collections/pages/server/database/schema'
import { withFrTranslation } from '../utils/fr-translations'

export default defineNitroPlugin((nitroApp) => {
  let done = false
  nitroApp.hooks.hook('request', async () => {
    if (done) return
    done = true
    try {
      const db = useDB() as any
      const pages = await db.select().from(pagesPages)
      for (const page of pages) {
        const next = withFrTranslation(page, page.translations)
        if (!next) continue
        await db.update(pagesPages)
          .set({ translations: next, updatedAt: new Date() })
          .where(eq(pagesPages.id as any, page.id))
      }
    }
    catch (err) {
      done = false
      console.error('[velo/ensure-fr] failed to backfill fr translations:', err)
    }
  })
})
