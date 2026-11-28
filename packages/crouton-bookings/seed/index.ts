/**
 * crouton-bookings seed provider (#696).
 *
 * Domain seed: a small, realistic booking demo so an app extending bookings
 * opens with populated tables instead of `0–0 / 0` empties. Seeds
 * - one `bookings_settings` row (statuses + age groups), so booking
 *   `status`/`group` values resolve to readable labels in the admin list;
 * - four locations: two courts with time slots, one rental without slots, and a
 *   bike shed with two slots, a full-day choice and three products — each
 *   location lists the catalog seed's products it offers, with a stock each;
 * - a handful of bookings referencing those locations/slots, dated relative to
 *   seed time so the calendar always shows upcoming reservations — one of them
 *   cancelled (tomorrow), so the "show cancelled" filter has something to show.
 *
 * Pure module: references the generated `bookings_*` table/column names as
 * strings, so it never imports the app's generated schema and loads cleanly
 * under jiti. Idempotent — stable `seedId(...)` ids upsert in place on re-run.
 *
 * Column notes (match the generator's Drizzle output):
 * - `slot` is a NOT-NULL JSON column; bookings at a location with slots store an
 *   array of slot ids (`["slot-0900"]`), the slotless booking stores the JSON
 *   literal `null` (`'null'` text), read as the whole day.
 * - `date` is an integer timestamp (unix seconds); `unixepoch() + N*86400`
 *   keeps demo bookings in the near future on every (re-)seed.
 * - every NOT-NULL column is set explicitly: Drizzle `$default(...)` is an
 *   ORM-time default, not a SQL DEFAULT, so raw-SQL upserts must supply them.
 */
import type { SeedProvider, SeedContext } from '@fyit/crouton-core/shared/seed'
import { seedId, raw } from '@fyit/crouton-core/shared/seed'

/** An option-item row as stored in `bookings_settings.statuses`/`.groups`. */
interface OptionItem {
  id: string
  label: string
  value: string
  translations?: { label?: Record<string, string> }
}

const STATUSES: OptionItem[] = [
  { id: 'confirmed', value: 'confirmed', label: 'Confirmed', translations: { label: { nl: 'Bevestigd', fr: 'Confirmé' } } },
  { id: 'pending', value: 'pending', label: 'Pending', translations: { label: { nl: 'In afwachting', fr: 'En attente' } } },
  { id: 'cancelled', value: 'cancelled', label: 'Cancelled', translations: { label: { nl: 'Geannuleerd', fr: 'Annulé' } } }
]

const GROUPS: OptionItem[] = [
  { id: 'adults', value: 'adults', label: 'Adults', translations: { label: { nl: 'Volwassenen', fr: 'Adultes' } } },
  { id: 'youth', value: 'youth', label: 'Youth', translations: { label: { nl: 'Jeugd', fr: 'Jeunes' } } }
]

interface SeedSlot {
  id: string
  label: string
}

/** The catalog seed's product keys (`packages/crouton-catalog/seed`). */
type ProductKey = 'court' | 'kayak' | 'cargo-bike' | 'kids-bike'

interface SeedLocation {
  key: string
  title: string
  titleNl: string
  color: string
  city: string
  slots: SeedSlot[]
  /** Offer a full-day choice next to the slots. */
  offerFullDay: boolean
  /** The catalog seed's products this location offers, with a stock each (#4044) */
  products: { product: ProductKey, stock: number }[]
}

const LOCATIONS: SeedLocation[] = [
  {
    key: 'center-court',
    title: 'Center Court',
    titleNl: 'Centrumplein',
    color: '#3b82f6',
    city: 'Antwerpen',
    slots: [
      { id: 'slot-0900', label: '09:00 – 10:00' },
      { id: 'slot-1000', label: '10:00 – 11:00' },
      { id: 'slot-1100', label: '11:00 – 12:00' }
    ],
    offerFullDay: false,
    products: [{ product: 'court', stock: 2 }]
  },
  {
    key: 'park-court',
    title: 'Park Court',
    titleNl: 'Parkzijde',
    color: '#22c55e',
    city: 'Gent',
    slots: [
      { id: 'slot-1400', label: '14:00 – 15:00' },
      { id: 'slot-1500', label: '15:00 – 16:00' }
    ],
    offerFullDay: false,
    products: [{ product: 'court', stock: 1 }]
  },
  {
    key: 'kayak-rental',
    title: 'Kayak Rental',
    titleNl: 'Kajakverhuur',
    color: '#f59e0b',
    city: 'Brugge',
    slots: [],
    offerFullDay: false,
    products: [{ product: 'kayak', stock: 8 }]
  },
  {
    key: 'bike-shed',
    title: 'Bike Shed',
    titleNl: 'Fietsenstalling',
    color: '#8b5cf6',
    city: 'Leuven',
    slots: [
      { id: 'slot-morning', label: 'Morning' },
      { id: 'slot-afternoon', label: 'Afternoon' }
    ],
    offerFullDay: true,
    products: [
      { product: 'cargo-bike', stock: 3 },
      { product: 'kids-bike', stock: 5 },
      { product: 'kayak', stock: 8 }
    ]
  }
]

interface SeedBooking {
  locationKey: string
  /** Slot ids; empty at a location without slots (the whole day). */
  slotIds: string[]
  /** Days from seed time (keeps demo bookings upcoming). */
  inDays: number
  quantity: number
  status: string
  group: string | null
  /** The booked product; defaults to the location's first product. */
  product?: ProductKey
}

const BOOKINGS: SeedBooking[] = [
  { locationKey: 'center-court', slotIds: ['slot-0900'], inDays: 1, quantity: 1, status: 'confirmed', group: 'adults' },
  { locationKey: 'center-court', slotIds: ['slot-1100'], inDays: 1, quantity: 1, status: 'confirmed', group: 'youth' },
  { locationKey: 'park-court', slotIds: ['slot-1400'], inDays: 2, quantity: 1, status: 'pending', group: 'adults' },
  { locationKey: 'kayak-rental', slotIds: [], inDays: 3, quantity: 2, status: 'confirmed', group: null },
  // appended last: booking ids include the list index
  { locationKey: 'bike-shed', slotIds: ['slot-morning'], inDays: 1, quantity: 2, status: 'confirmed', group: 'adults', product: 'cargo-bike' },
  // One cancelled booking tomorrow, so "Show cancelled" has something to show (#3651, #4562).
  { locationKey: 'kayak-rental', slotIds: [], inDays: 1, quantity: 1, status: 'cancelled', group: null }
]

function locationId(ctx: SeedContext, key: string): string {
  return seedId('bookings-location', ctx.teamSlug, key)
}

/** Same id the catalog seed gives its products (`packages/crouton-catalog/seed`). */
function productId(ctx: SeedContext, key: string): string {
  return seedId('catalog-product', ctx.teamSlug, key)
}

function locationProduct(ctx: SeedContext, key: string): string {
  return productId(ctx, LOCATIONS.find(l => l.key === key)!.products[0]!.product)
}

export const provider: SeedProvider = {
  id: 'bookings',
  // catalog first: locations and bookings point at its products (#4044)
  dependsOn: ['auth', 'catalog'],
  seed(ctx) {
    // Settings — one row per team (status + group option lists).
    ctx.upsert('bookings_settings', { id: seedId('bookings-settings', ctx.teamSlug) }, {
      teamId: ctx.teamId,
      owner: 'seed',
      order: 0,
      statuses: STATUSES,
      groups: GROUPS,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      createdBy: 'seed',
      updatedBy: 'seed'
    })

    // Locations.
    LOCATIONS.forEach((loc, index) => {
      ctx.upsert('bookings_locations', { id: locationId(ctx, loc.key) }, {
        teamId: ctx.teamId,
        owner: 'seed',
        order: index,
        title: loc.titleNl,
        color: loc.color,
        city: loc.city,
        content: null,
        slots: loc.slots,
        products: loc.products.map(p => ({ product: productId(ctx, p.product), stock: p.stock })),
        offerFullDay: loc.offerFullDay,
        openDays: null,
        slotSchedule: null,
        blockedDates: null,
        maxBookingsPerMonth: null,
        translations: {
          [ctx.locale]: { title: loc.titleNl, city: loc.city },
          en: { title: loc.title, city: loc.city }
        },
        createdAt: ctx.now,
        updatedAt: ctx.now,
        createdBy: 'seed',
        updatedBy: 'seed'
      })
    })

    // Bookings — slot bookings store a JSON array of slot ids; the slotless row
    // stores the JSON literal `null` (NOT-NULL column → `'null'` text; read as
    // full day — new live bookings store `["all-day"]` since #4172).
    BOOKINGS.forEach((booking, index) => {
      ctx.upsert(
        'bookings_bookings',
        { id: seedId('bookings-booking', ctx.teamSlug, booking.locationKey, String(index)) },
        {
          teamId: ctx.teamId,
          owner: 'seed',
          order: index,
          location: locationId(ctx, booking.locationKey),
          date: raw(`unixepoch() + ${booking.inDays * 86400}`),
          slot: booking.slotIds.length ? booking.slotIds : raw("'null'"),
          group: booking.group,
          quantity: booking.quantity,
          status: booking.status,
          product: booking.product ? productId(ctx, booking.product) : locationProduct(ctx, booking.locationKey),
          createdAt: ctx.now,
          updatedAt: ctx.now,
          createdBy: 'seed',
          updatedBy: 'seed'
        }
      )
    })
  }
}

export default provider
