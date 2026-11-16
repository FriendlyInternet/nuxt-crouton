/**
 * crouton-catalog seed provider.
 *
 * Two demo products per team ("Court" and "Kayak"), so an app with bookings
 * opens with a populated Products list. Pure module: references the
 * `catalog_products` table/column names as strings, so it loads cleanly under
 * jiti. Idempotent — stable `seedId(...)` ids upsert in place on re-run.
 * Every NOT-NULL column is set explicitly: Drizzle `$default(...)` is an
 * ORM-time default, not a SQL DEFAULT.
 */
import type { SeedProvider } from '@fyit/crouton-core/shared/seed'
import { seedId } from '@fyit/crouton-core/shared/seed'

const PRODUCTS = [
  { key: 'court', title: 'Court', titleNl: 'Terrein' },
  { key: 'kayak', title: 'Kayak', titleNl: 'Kajak' }
]

export const provider: SeedProvider = {
  id: 'catalog',
  dependsOn: ['auth'],
  seed(ctx) {
    PRODUCTS.forEach((product, index) => {
      ctx.upsert('catalog_products', { id: seedId('catalog-product', ctx.teamSlug, product.key) }, {
        teamId: ctx.teamId,
        owner: 'seed',
        order: index,
        title: product.title,
        description: null,
        active: true,
        translations: {
          en: { title: product.title },
          nl: { title: product.titleNl }
        },
        createdAt: ctx.now,
        updatedAt: ctx.now,
        createdBy: 'seed',
        updatedBy: 'seed'
      })
    })
  }
}
