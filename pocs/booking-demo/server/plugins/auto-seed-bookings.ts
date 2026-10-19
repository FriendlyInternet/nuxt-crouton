/**
 * Auto-seed bookings demo content on team creation (booking-demo POC, #924).
 *
 * The `poc-deploy` preview is meant to be a *testable* URL, but a fresh staging
 * D1 has no bookings — so the composed `/admin/[team]/blocks` page (and the
 * native `/bookings`) open empty, and the cross-pane filter test has nothing to
 * filter. This plugin listens for the auth `auth:team:created` event (fired from
 * crouton-auth's `afterCreateOrganization`) and populates the new team with a
 * small, realistic set of locations + bookings + settings, so every team —
 * including the deploy's auto-provisioned `review-*` login — boots populated.
 *
 * Why a POC-local plugin and not the shared `@fyit/crouton-bookings/seed`
 * provider (as apps/velo uses): that provider writes an `order` column that
 * velo's customized tables carry but booking-demo's generated tables do NOT
 * (verified against the migration) — so the provider's SQL would throw here.
 * This inserts against booking-demo's OWN schema via drizzle, so it always
 * matches. (If booking-demo ever graduates, switch to the shared provider.)
 *
 * Unconditional: booking-demo is a pure demo POC with no real customers, so
 * every team is a demo — no `-demo` slug gate (unlike velo #849). Idempotent via
 * stable team-scoped ids + `onConflictDoNothing`. Non-blocking: wrapped in
 * try/catch so a seed failure never breaks team creation.
 */
import { defineNitroPlugin } from 'nitropack/runtime'
import { bookingsBookings } from '@fyit/crouton-bookings/collections/bookings/server/database/schema'
import { bookingsLocations } from '@fyit/crouton-bookings/collections/locations/server/database/schema'
import { bookingsSettings } from '@fyit/crouton-bookings/collections/settings/server/database/schema'

const STATUSES = [
  { id: 'confirmed', value: 'confirmed', label: 'Confirmed' },
  { id: 'pending', value: 'pending', label: 'Pending' },
  { id: 'cancelled', value: 'cancelled', label: 'Cancelled' },
]
const GROUPS = [
  { id: 'adults', value: 'adults', label: 'Adults' },
  { id: 'youth', value: 'youth', label: 'Youth' },
]

const LOCATIONS = [
  { key: 'center-court', title: 'Center Court', color: '#3b82f6', city: 'Antwerpen', inventory: false, quantity: null as number | null,
    slots: [{ id: 'slot-0900', label: '09:00 – 10:00', capacity: 1 }, { id: 'slot-1000', label: '10:00 – 11:00', capacity: 1 }, { id: 'slot-1100', label: '11:00 – 12:00', capacity: 2 }] },
  { key: 'park-court', title: 'Park Court', color: '#22c55e', city: 'Gent', inventory: false, quantity: null,
    slots: [{ id: 'slot-1400', label: '14:00 – 15:00', capacity: 1 }, { id: 'slot-1500', label: '15:00 – 16:00', capacity: 1 }] },
  { key: 'kayak-rental', title: 'Kayak Rental', color: '#f59e0b', city: 'Brugge', inventory: true, quantity: 8, slots: null as unknown[] | null },
]

const BOOKINGS = [
  { loc: 'center-court', slot: ['slot-0900'], inDays: 1, quantity: 1, status: 'confirmed', group: 'adults' },
  { loc: 'center-court', slot: ['slot-1100'], inDays: 1, quantity: 1, status: 'confirmed', group: 'youth' },
  { loc: 'center-court', slot: ['slot-1000'], inDays: 4, quantity: 1, status: 'pending', group: 'adults' },
  { loc: 'park-court', slot: ['slot-1400'], inDays: 2, quantity: 1, status: 'pending', group: 'adults' },
  { loc: 'park-court', slot: ['slot-1500'], inDays: 6, quantity: 2, status: 'confirmed', group: 'youth' },
  // Inventory (slotless) bookings: an empty slot array, NOT null — `slot` is
  // NOT NULL, and drizzle binds JS null as SQL NULL (skipping the json column's
  // serializer), which would violate the constraint. `[]` = "no named slots".
  { loc: 'kayak-rental', slot: [] as string[], inDays: 3, quantity: 2, status: 'confirmed', group: null as string | null },
  { loc: 'kayak-rental', slot: [], inDays: 8, quantity: 1, status: 'cancelled', group: null },
]

const DAY_MS = 86_400_000

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('crouton:operation', async (payload: any) => {
    if (payload?.type !== 'auth:team:created' || !payload.teamId) return

    const teamId: string = payload.teamId
    try {
      const db = useDB()
      const now = new Date()
      const locId = (key: string) => `seed-${teamId}-${key}`
      const base = { teamId, owner: 'seed', createdAt: now, updatedAt: now, createdBy: 'seed', updatedBy: 'seed' }

      await db.insert(bookingsSettings).values({
        id: `seed-${teamId}-settings`, statuses: STATUSES, groups: GROUPS, ...base,
      }).onConflictDoNothing()

      await db.insert(bookingsLocations).values(LOCATIONS.map(l => ({
        id: locId(l.key), title: l.title, color: l.color, city: l.city,
        inventoryMode: l.inventory, quantity: l.inventory ? l.quantity : null,
        slots: l.inventory ? null : l.slots,
        translations: { en: { title: l.title, city: l.city }, nl: { title: l.title, city: l.city } },
        ...base,
      }))).onConflictDoNothing()

      await db.insert(bookingsBookings).values(BOOKINGS.map((b, i) => ({
        id: `seed-${teamId}-bk-${i}`, location: locId(b.loc),
        date: new Date(now.getTime() + b.inDays * DAY_MS),
        slot: b.slot, group: b.group, quantity: b.quantity, status: b.status,
        ...base,
      }))).onConflictDoNothing()

      console.log(`[booking-demo/auto-seed] Seeded demo bookings for team ${teamId}`)
    }
    catch (err) {
      // Non-blocking: a seed failure must never break team creation.
      console.error('[booking-demo/auto-seed] Failed to seed demo bookings:', err)
    }
  })
})
