/**
 * crouton-sales seed provider (#86).
 *
 * Domain seed: an event with a helper PIN, plus a couple of categories and
 * products — a real, ring-up-able kassa. No grant seeding is needed: the
 * `crouton:scoped-access:before-redeem` hook lazily syncs the event's
 * `helperPin` into a grant on the first PIN login.
 *
 * Block demo (only when crouton-pages is present, via `ctx.createPageWithBlocks`):
 * a `scoped` page embedding the `eventWorkspaceBlock`. The block stores the
 * event *slug*; the page's scope is derived at read time
 * (`crouton:pages:derive-scope` resolves slug → id), so the page has no
 * seed-time ordering dependency on the event row.
 *
 * Pure module: references sales table/columns by name, so it never imports the
 * app's generated schema and loads cleanly under jiti.
 */
import type { SeedProvider, SeedContext } from '@fyit/crouton-core/shared/seed'
import { seedId } from '@fyit/crouton-core/shared/seed'

const EVENT_SLUG = 'vlaamsekermis'
const HELPER_PIN = '1234'

interface SeedProduct {
  slug: string
  title: string
  price: number
  category: 'drinks' | 'food'
  order: number
}

const PRODUCTS: SeedProduct[] = [
  { slug: 'pils', title: 'Pils', price: 2.5, category: 'drinks', order: 1 },
  { slug: 'frisdrank', title: 'Frisdrank', price: 2.0, category: 'drinks', order: 2 },
  { slug: 'koffie', title: 'Koffie', price: 1.8, category: 'drinks', order: 3 },
  { slug: 'frietjes', title: 'Frietjes', price: 3.5, category: 'food', order: 4 },
  { slug: 'hamburger', title: 'Hamburger', price: 5.0, category: 'food', order: 5 }
]

function seedCatalog(ctx: SeedContext) {
  const eventId = seedId('event', ctx.teamSlug, EVENT_SLUG)

  ctx.upsert('sales_events', { id: eventId }, {
    teamId: ctx.teamId,
    owner: 'seed',
    title: 'Vlaamse Kermis',
    slug: EVENT_SLUG,
    description: 'Demo-evenement met een werkende kassa.',
    eventType: 'fair',
    status: 'active',
    isCurrent: true,
    requiresClient: false,
    helperPin: HELPER_PIN,
    currency: 'EUR',
    metadata: {},
    startDate: ctx.now,
    endDate: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    createdBy: 'seed',
    updatedBy: 'seed'
  // ifAbsent: seed the demo once — a re-seed on every staging deploy must NOT
  // overwrite the user's edits (title/pin/order/price). Deleted rows are still
  // re-created; only existing ones are left alone (#1579).
  }, { ifAbsent: true })

  const categoryIds: Record<SeedProduct['category'], string> = {
    drinks: seedId('cat', ctx.teamSlug, EVENT_SLUG, 'drinks'),
    food: seedId('cat', ctx.teamSlug, EVENT_SLUG, 'food')
  }

  ctx.upsert('sales_categories', { id: categoryIds.drinks }, {
    teamId: ctx.teamId,
    owner: 'seed',
    eventId,
    title: 'Dranken',
    displayOrder: 1,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    createdBy: 'seed',
    updatedBy: 'seed'
  }, { ifAbsent: true })
  ctx.upsert('sales_categories', { id: categoryIds.food }, {
    teamId: ctx.teamId,
    owner: 'seed',
    eventId,
    title: 'Eten',
    displayOrder: 2,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    createdBy: 'seed',
    updatedBy: 'seed'
  }, { ifAbsent: true })

  for (const product of PRODUCTS) {
    ctx.upsert('sales_products', { id: seedId('prd', ctx.teamSlug, EVENT_SLUG, product.slug) }, {
      teamId: ctx.teamId,
      owner: 'seed',
      order: product.order,
      eventId,
      categoryId: categoryIds[product.category],
      title: product.title,
      price: product.price,
      isActive: true,
      requiresRemark: false,
      hasOptions: false,
      multipleOptionsAllowed: false,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      createdBy: 'seed',
      updatedBy: 'seed'
    }, { ifAbsent: true })
  }
}

export const provider: SeedProvider = {
  id: 'sales',
  dependsOn: ['auth'],
  seed(ctx) {
    seedCatalog(ctx)

    // Block demo — only when crouton-pages is part of the app. A scoped page
    // embedding the kassa block; opening it gates on the event's helper PIN.
    if (ctx.createPageWithBlocks) {
      ctx.createPageWithBlocks({
        slug: EVENT_SLUG,
        locale: ctx.locale,
        title: 'Vlaamse Kermis',
        visibility: 'scoped',
        showInNavigation: false,
        blocks: [
          {
            type: 'eventWorkspaceBlock',
            attrs: { eventSlug: EVENT_SLUG, height: 'tall' }
          }
        ]
      })
    }
  }
}

export default provider
