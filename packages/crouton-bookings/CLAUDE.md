# CLAUDE.md - @fyit/crouton-bookings

## Package Purpose

Booking system layer for Nuxt applications: bookings for locations with or without time slots, each offering team products (`@fyit/crouton-catalog`) with a stock. Works as a Nuxt layer that integrates with `@fyit/crouton-core` (which bundles `@fyit/crouton-auth`).

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer configuration, component registration, i18n setup |
| `app/composables/useBookingsStore.ts` | **One bookings screen's shared state (#2561)** — filters, the one selected day (`selectDay` from the calendar; `selectDate` for a booking's date / `goToToday` also shows its period), `shownDate` (the calendar's week/month; `showPeriod` when the list scrolls), `scrollTarget` (a fresh Date per request, so the same day scrolls again), hovered booking, `calendarView` (week/month), and the "new booking" date (`startCreate` refuses read-only / no locations / closed / fully booked and says which; `finishCreate(reload)` closes, reloads, then scrolls). Holds no data: handed the page's `bookings`, `calendarBookings` (whole team, decides "full" via `utils/day-availability`), `locations`, `readOnly`. Pure `createBookingsStore` (tested in `test/bookings-store.test.ts`) + `provideBookingsStore` / `useBookingsStore` (inject). The Panel provides one (or takes the page's via its `store` prop — `provideBookingsStore(src, existing?)` — so inline + full-screen Panels on the admin page share it); the layout blocks move onto it next (they still use `useBookingsLayoutFilters`) |
| `app/composables/useBookingAvailability.ts` | Fetch availability (per-date bookings per product), slots (`hasSlots`), schedule rules |
| `app/composables/useBookingCart.ts` | Shopping cart for bookings — counts per product, cart-aware (`productLeft`); items carry `productId` + `quantity` (#4110); also loads the team's products (`teamProducts`, not awaited, #4314) |
| `app/composables/useBookingsSettings.ts` | Team booking settings |
| `app/composables/useBookingEmail.ts` | Email functionality (opt-in) |
| `app/composables/useBookingEmailVariables.ts` | Email template variables + demo data for previews |
| `app/pages/dashboard/[team]/settings/email-templates.vue` | Email template management page |
| `app/types/booking.ts` | TypeScript type definitions |
| `server/api/crouton-bookings/` | API endpoints |
| `server/utils/booking-emails.ts` | Email utilities |
| `server/utils/email-service.ts` | Sends + logs booking emails. Reads `bookings_emailtemplates`/`bookings_emaillogs` from this package (not the app's `~~/server/db/schema`); a booking email is never sent without a log row, and a missing table is a `[booking-email]` console error; subject/body fall back customer language → app default language (`requiredLocale`) → main field → any other translation, and a template that still renders an empty subject or body is not sent: one `failed` log row per recipient with "Template has no subject or body in any language" (#4244); a send held back by the team's Send emails switch (`bookings_settings.sendEmails`, `isTeamBookingEmailOn`) writes one `skipped` row per recipient and returns `skipped: true` (#3929). Tests: `test/booking-emails.test.ts`, `test/email-service.test.ts` |
| `collections/<name>/` | **The 5 bookings collections, owned end to end (#2278)** — `bookings`, `locations`, `settings`, `emailtemplates`, `emaillogs`: `server/database/{schema,queries}.ts`, `server/api/teams/[id]/bookings-<plural>/*`, `types.ts`, `app/composables/useBookings<Plural>.ts`, `app/components/List.vue` (+ `_Form.vue`, repeater inputs). Each is a Nuxt layer extended by `nuxt.config.ts`; `app/app.config.ts` registers them under `croutonCollections`. Table names, API paths and registry keys are byte-identical to what apps used to generate. Moved verbatim from velo's generated layer, hand edits included. Create/edit routes validate the body with hand-added zod schemas (#3377; unknown keys stripped, wrong types 400) — `scripts/check-collection-body-validation.mjs` catches drift. POST/PATCH of `bookings`, `emailtemplates`, `emaillogs` call `assertBookings<X>References` (queries.ts → crouton-core `assertRefsInTeam`) so a reference to another team's record is a 400 (#3378). The `locations` and `emailtemplates` forms require the app's default language, not always English (#4236): `_Form.vue` passes `useI18n()` into the composable's default export, which builds `bookingsLocationSchemaFor(locale)` / `bookingsEmailtemplateSchemaFor(locale)` (rule from `@fyit/crouton-catalog/required-locale`; the old `…Schema` exports are the `en` ones), and as that translation is edited `app/utils/applyDefaultLocaleLocationFields.ts` / `applyDefaultLocaleEmailtemplateFields.ts` copy that language's `title`/`content` and `name`/`subject`/`body` into the main columns. Apps must **not** generate these: the CLI refuses (`ownsCollections: true` in the manifest). Importable: `@fyit/crouton-bookings/collections/<name>/types` and `…/server/database/{schema,queries}` |
| Route access (#3135) | **Writes to `locations`, `settings`, `emailtemplates`, all `emaillogs` routes and `admin-bookings` need `requireCan(event, 'bookings:manage')`; `bookings-bookings` POST needs `bookings:create` (#4108; owner/admin by default).** Members: `bookings-bookings` list returns only their own rows unless they have `bookings:manage` (no user emails); `bookings/[id]` PATCH and `resend-email` are owner-or-`bookings:manage` (403 otherwise). Update/delete queries take `{ seesAll }` (the route asks `can()`), never a role. The customer calendar reads `calendar-bookings` (member-safe: id/location/date/slot/quantity/status only). Template `fromEmail` must be on the domain of `runtimeConfig.email.from` (`server/utils/sender-domain.ts`). Tests: `test/booking-authz.test.ts` |
| `server/db/schema.ts` | Re-export NuxtHub scans so consuming apps pick up the 5 collection tables in `db:generate` (velo: "No schema changes" after the move) |
| `schemas/` | Field descriptions of the collections, read by the manifest for AI hints. **Not** generated from any more (#2278): the source of truth is `collections/*/server/database/schema.ts`. Change both together |
| `seed/index.ts` | Seed provider (`@fyit/crouton-bookings/seed`, #696) — one settings row (statuses + groups) + demo locations (two courts with time slots, one rental without slots (stock 8), and a Bike Shed (two slots, full day, three products)) + a few bookings, so previews open populated |

**Note:** Since #2278 the collection composables (`useBookingsBookings()`, `useBookingsLocations()`, …), tables and CRUD routes ship from this package (`collections/*`). A consuming app only extends `@fyit/crouton-bookings`; it generates nothing for bookings and lists nothing in `crouton.config.js` for it. `features.bookings` in that file only carries the email configuration. Changing a column = edit `collections/<name>/server/database/schema.ts` here, then `db:generate` in each app.

## Architecture

### Components (Prefixed: CroutonBooking)

```
CroutonBooking
├── Slot/
│   └── Indicator.vue   - Visual slot indicator; its hover highlight (hoverBooking) reacts to mouse/pen only — touch is ignored (#4302)
├── Panel.vue           - Main booking sidebar (CroutonBookingsPanel; self-fetches via useBookingsList); forwards a `#toolbar-end` slot onto the calendar's month/week label row (`#header-end`, the admin full-screen close); the month label also runs `store.goToToday`; `CalendarFoldHandle` at the left end of that row (`#header-start`) folds month ↔ week (#4516)
├── LayoutCalendar.vue  - CroutonBookingsLayoutCalendar: the calendar as a placeable layout block (#709), registered in croutonLayoutBlocks as `bookings-calendar` (compound, minWidth 520, minHeight 480, fill). Wraps CroutonBookingsPanel; the deterministic layout pass picks it → calendar-primary.
├── Layout/             - ATOMIC layout blocks (#924, "bookings-from-blocks" gap test) — the Panel's sub-surfaces broken out so a user can reassemble the native layout from `croutonLayoutBlocks`. Each self-fetches (shared useFetch key per team + `dedupe: 'defer'` ⇒ one call per key; see *useFetch keys carry the team* below) + coordinates cross-pane via useBookingsLayoutFilters.
│   ├── List.vue         - CroutonBookingsLayoutList (`bookings-list`) — the list, shared-filter aware
│   ├── CalendarOnly.vue - CroutonBookingsLayoutCalendarOnly (`bookings-calendar-only`) — just the grid
│   ├── Locations.vue    - CroutonBookingsLayoutLocations (`bookings-locations`) — selectable location list → shared location filter (one location at a time, #4471) (a robust list, NOT the geo/maplibre PanelMap — see #924 gap notes)
│   └── Filters.vue      - CroutonBookingsLayoutFilters (`bookings-filters`) — status/location/cancelled → shared store (Panel-only view controls hidden via `PanelFilters` `view-toggles=false`, #2563)
├── Calendar.vue        - Calendar date picker
├── CalendarFoldHandle.vue - icon-only toggle (`calendar-days` in week, `calendar-minus-2` in month; tap/Enter/Space) that switches calendarView month ↔ week (#4516)
├── List.vue            - Bookings list; `listToggles` (Panel only) puts Show cancelled / Map (Map only with coordinates) on the first month label, or atop a loading/error/empty list (#4492)
├── ListToggles.vue     - the Show cancelled / Map text toggles List.vue renders (internal)
├── BookingCard.vue     - Individual booking card
├── BookingCreateCard.vue - Booking creation form
├── LocationTabs.vue   - CroutonBookingsLocationTabs: one sideways-scrolling location tab row (optional "All", admin "+"; hidden with one location), shared by the panel and the booking form (#4471)
├── DateBadge.vue       - Date display badge
├── PanelFilters.vue    - Filter controls; `viewToggles` (default on) = Panel mode: only the admin no-locations prompt renders; with `viewToggles` off it renders the cog row (View · Show cancelled) and the location tab row (composed pages); in the Panel, Show cancelled and Map live on the list (#4492)
└── PanelMap.vue        - Map display
```

### API Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/api/crouton-bookings/teams/[id]/availability` | GET | Booked slots for a date range, plus each date's `bookings` (`product`, `quantity`, `slotIds`; full day = `['all-day']`) |
| `/api/crouton-bookings/teams/[id]/customer-bookings` | GET | Get user's bookings with email stats |
| `/api/crouton-bookings/teams/[id]/customer-bookings-batch` | POST | Submit cart (batch checkout). Refuses with 400 (bad/over-limit quantity), 404 (unknown or other team's location), 409 (no room left; earlier rows of the request are removed). Capacity is checked inside the INSERT so racing requests can't overbook |
| `/api/crouton-bookings/teams/[id]/customer-locations` | GET | Get accessible locations |
| `/api/crouton-bookings/teams/[id]/monthly-booking-count` | GET | Get user's monthly booking count for a location |
| `/api/crouton-bookings/teams/[id]/calendar-bookings` | GET | Calendar view of bookings (no emails; every team member sees all the team's bookings, limited to id/location/date/slot/quantity/status/product) |
| `/api/crouton-bookings/teams/[id]/bookings/[bookingId]` | PATCH | Update a booking (owner or team admin; others get 403); accepts `quantity` (whole number ≥ 1, re-checked against stock, 409 when it doesn't fit, #4112) |
| `/api/crouton-bookings/teams/[id]/bookings/[bookingId]/resend-email` | POST | Resend email (if enabled; 409 when the team switched booking emails off) |

### Counting (#4061)

Free places are counted per product, per day, per slot:

`left(product, day, slot) = stock − summed quantity of that product's non-cancelled bookings that day holding that slot or the full day`

- A location with no named slots has one implicit full-day slot.
- A full-day booking holds every slot; a full-day request needs room in every slot.
- A booking with no `product` (old rows) counts against every product of its location; a stored quantity below 1 counts as 1.
- A location is fully booked on a day only when every product it lists is at 0 in every slot; a location listing no products is left out of the day check.
- The old slot `capacity`, location `quantity` and inventory switch are gone from the schema and the database (#4172 removed the readers, 5b.2 the columns). A location has no slots when its `slots` list is empty, and then books `['all-day']`.
- The pure rule is `app/utils/capacity.ts` (`leftFor`, `fitsCapacity`, `isLocationFull`, `parseLocationProducts`); the calendar's `isDayFullyBooked` (`app/utils/day-availability.ts`) and the cart pre-check use it; `guardSql` is the same rule in SQL. The booking form counts with it too (#4110): `useBookingCart` counts per product, cart-aware, through `utils/product-left.ts` (`getSlotRemaining`, `maxQuantity` for the picked `formState.productId` — auto-picked when the location lists one; a location change resets product, slots, group and amount (1), and a product the location doesn't list is dropped (#4331)), and every cart item carries `productId` and `quantity` (default 1) at every location; a location without slots (an empty `slots` list, `hasSlots` false) books `['all-day']` by itself, never the old `inventory` id. `Calendar.vue` marks each slot full / partly booked / cancelled and shows `booked / stock` through `utils/slot-marks.ts` (built on `utils/slot-status.ts`, per-slot booked/stock over all listed products, #4111). The create card (`BookingCreateCard.vue`, #4112) shows locations as the shared `CroutonBookingsLocationTabs` row (#4471), product buttons when `showProductPicker` (`utils/product-picker.ts`) is true (the product list comes from `useBookingCart().teamProducts`, not awaited, so the card draws at once — #4314), slot buttons as `label (N free)` and a `UInputNumber` drawn `booked/free` capped at `maxQuantity`; with nothing free (`maxQuantity` 0) it shows a 'Fully booked' badge instead (#4331); an edit sends `product` + `quantity` (`editBookingBody` in `utils/booking-form.ts`).

**Products (`products`, #3967).** A location lists the team products it offers as `[{ product, stock }]` (a `catalog_products` id, stock ≥ 1, each product once, own team only). The location form's Bookings tab edits this list (pick a team product, set its stock ≥ 1, add/remove; an emptied list saves as `[]`) through `app/utils/location-products-edit.ts`, tested in `test/location-products-edit.test.ts` (#4087). A booking carries `product`. Existing rows were converted by the `*_products_per_location.sql` migration (one `loc-<id>` product per location). A location saved without products gets the same own product with stock 1, named in the app's default language (`croutonI18n.defaultLocale`, #4236) (`ensureLocationProducts` in `server/utils/location-products.ts`, #4044; the location POST/PATCH routes and the velo/booking-demo seeds call it). A booking always carries a product of its own location (`resolveProduct` in `server/utils/booking-capacity.ts`, on every write): a named product must be listed (else 400 "Unknown product"), none named → the location's only product, two or more listed → 400 "Pick a product", none listed → 400. Counting uses `stock` per product (see Counting); stock is read from `bookings_locations.products` inside the guarded statement, so a product unlisted after validation is refused (409). Deleting a catalog product that a location of the team still lists is refused (409, 'Still offered by N location(s): …. Remove it there first.', ≤5 titles in the app's default language): `server/plugins/catalog-delete-guard.ts` → `productBlockers` in `server/utils/product-in-use.ts` (#4278). Bookings that carry the product never block it.

**Full day (`offerFullDay`, #2261).** A location with no named slots offers only the built-in
`all-day` slot (`ALL_DAY_SLOT`). A location with named slots can switch `offerFullDay` on to
offer it *next to* them. In one booking the full day can't be combined with another slot (400).
Across bookings it takes one unit from every slot (see Counting), so at stock 1 it can't share a
date with another booking; at stock ≥ 2 it can. The booking form follows the stock rule too;
it only refuses the full day combined with another slot in one booking, and a schedule-closed
slot (closing any slot also closes the full day that date). The pure helpers:
`app/utils/full-day.ts` (`withFullDay`, `isBlockedByFullDay`,
`fullDayConflict`), tested in `test/full-day.test.ts`. `useBookingCart`'s `isSlotDisabled(id, [])`
asks "booked/full/closed?" regardless of the current ticks.

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',  // bundles crouton-auth
    '@fyit/crouton-bookings',
    './layers/bookings' // Generated collections
  ],

  // Optional: Enable email module
  runtimeConfig: {
    croutonBookings: {
      email: { enabled: true }
    },
    public: {
      croutonBookings: {
        email: { enabled: true }
      }
    }
  }
})
```

## Common Tasks

### Add a New Composable

1. Create file in `app/composables/useNewFeature.ts`
2. Export composable function
3. Will auto-import via Nuxt layer

### Add a New Component

1. Create in `app/components/[Category]/MyComponent.vue`
2. Component auto-registers as `CroutonBooking[Category]MyComponent`

### Add a New API Endpoint

1. Create in `server/api/crouton-bookings/teams/[id]/endpoint.get.ts`
2. Use `defineEventHandler`
3. Import utilities from consuming app context (layer pattern)

### Modify Availability Logic

1. Counting is `app/utils/capacity.ts` (+ `app/utils/product-left.ts` for the cart)
2. `useBookingCart` (`getSlotRemaining`, `maxQuantity`, `canAddToCart`) wires it to the form
3. `app/composables/useBookingAvailability.ts` only fetches the per-date bookings and parses slots/rules

### Customize Email Behavior

1. Edit `server/utils/booking-emails.ts` for utilities
2. Apps override `resend-email.post.ts` for custom logic
3. Email module is opt-in via `croutonBookings.email.enabled`; a team admin can also switch a team's booking emails off in Booking settings (`bookings_settings.sendEmails`, default on — off if any of the team's settings rows says off): sends are then logged as `skipped` and resend returns 409

### Manage Email Templates

Navigate to `/dashboard/[team]/settings/email-templates` to manage email templates.

**Available Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `{{customer_name}}` | Customer's name | John Doe |
| `{{customer_email}}` | Customer's email | john@example.com |
| `{{booking_date}}` | Formatted booking date | Monday, January 15, 2024 |
| `{{booking_slot}}` | Time slot(s) | 10:00 - 11:00 |
| `{{location_name}}` | Location name | Main Office |
| `{{location_title}}` | Location title | Downtown Branch |
| `{{location_street}}` | Street address | 123 Main St |
| `{{location_city}}` | City | Amsterdam |
| `{{location_address}}` | Full address | 123 Main St, Amsterdam |
| `{{team_name}}` | Team/business name | Amsterdam Tennis Club |
| `{{team_email}}` | Team contact email | info@amsterdamtennis.nl |
| `{{team_phone}}` | Team contact phone | +31 20 987 6543 |
| `{{booking_reference}}` | Booking reference number | BK-2025-0124 |

**Trigger Types:**

| Trigger | When Sent |
|---------|-----------|
| `booking_created` | When a new booking is made |
| `reminder_before` | Before the booking date (use `daysOffset`) |
| `booking_cancelled` | When a booking is cancelled |
| `follow_up_after` | After the booking date (use `daysOffset`) |

**Using the Editor:**

The email template editor supports:
- Rich text editing via TipTap
- Variable insertion by typing `{{` to trigger autocomplete
- Live preview with realistic demo data
- Translation tabs (EN, NL, FR) for multilingual templates
- Location selector (specific location or "All Locations")
- Responsive layout (side-by-side on desktop, tabs on mobile)

**Demo Data for Preview:**

The `useBookingEmailVariables()` composable provides realistic demo data for previews:

```typescript
const { variables, getPreviewValues, demoData } = useBookingEmailVariables()

// Demo customer: Emma van der Berg, emma.vanderberg@gmail.com
// Demo booking: Friday, January 24, 2025 at 14:00 - 15:00
// Demo location: Court A, Sportlaan 42, Amsterdam
// Demo team: Amsterdam Tennis Club
```

## Dependencies

- **Required**: `@fyit/crouton-core` (bundles `@fyit/crouton-auth`), `@fyit/crouton-calendar` (extended by this layer; owns the swipeable week/month views and swipe logic — `Calendar.vue` supplies the `#day` content and forwards `#header-end` / `today`, #2574, #4516), `@fyit/crouton-catalog` (extended by this layer; owns the shared team product list)
- **Optional**: `@fyit/crouton-email` (for email features)
- **Peer**: `@nuxtjs/i18n` (auto-included)

## Table Naming Convention

Package expects tables prefixed with `bookings`:

| Schema | Table Name |
|--------|------------|
| booking.json | `bookingsBookings` |
| location.json | `bookingsLocations` |
| settings.json | `bookingsSettings` |
| email-template.json | `bookingsEmailtemplates` |
| email-log.json | `bookingsEmaillogs` |

## i18n Keys

Translations in `i18n/locales/{en,nl}.json`:

```
bookings.
├── sidebar.*        - Sidebar UI
├── cart.*           - Cart UI
├── form.*           - Form labels
├── status.*         - Booking statuses
├── confirm.*        - Confirmation dialogs
├── buttons.*        - Action buttons
├── meta.*           - Metadata labels
└── common.*         - Common terms
```

## Demo Seeding (`@fyit/crouton-bookings/seed`)

Part of the composable seeding system (epic #82, contract in
`@fyit/crouton-core/shared/seed`). Provider id `bookings`, `dependsOn: ['auth', 'catalog']`:

- **Settings:** one `bookings_settings` row with three statuses
  (confirmed/pending/cancelled) and two age groups (adults/youth), each an
  option item (`{ id, value, label, translations }`) so booking `status`/`group`
  values resolve to readable, translated labels in the admin list.
- **Locations:** four `bookings_locations` — two courts with named time slots,
  one rental without slots (its product's stock is 8), and a Bike Shed with two
  slots, `offerFullDay` and three products (cargo-bike 3 / kids-bike 5 /
  kayak 8). Titles carry `nl`/`en` translations.
- **Bookings:** five `bookings_bookings` referencing those locations/slots,
  dated `unixepoch() + N*86400` so they always sit in the near future (the Bike
  Shed one names its product, cargo-bike; the others book their location's
  first product). Rows with slots store a JSON array of slot ids (`["slot-0900"]`); the slotless row stores
  the JSON literal `null` (read as full day; new live bookings store
  `["all-day"]` since #4172; the `slot` column is NOT-NULL JSON).

Pure module (references `bookings_*` table/columns by name, loads under jiti).
Idempotent — stable `seedId(...)` ids upsert in place. Every NOT-NULL column is
set explicitly because Drizzle `$default(...)` is ORM-time, not a SQL DEFAULT.
Run via an app's `crouton-seed` / `db:seed:*` scripts.

**Deploy check (#3751):** an app whose review login must land on this demo data lists the
tables in `reviewLogin.requireData` (`deploy.config.json`, e.g. booking-demo:
`["bookings_locations", "bookings_bookings"]`). The deploy's review-login step then logs the
seeded team's row counts and advertises no login if any is 0 (`scripts/seed-review-login.mjs
--require-data`).

## useFetch keys carry the team (#3751)

Every `useFetch` in `useBookingsList`, `useBookingCart` and `useBookingOptions` has the team
id in its `key` (e.g. `crouton-booking-list-locations-<scope>-<teamId>`). With a fixed key
and no `watch`, Nuxt does **not** re-fetch when only the URL changes, so a fetch that ran
before the team was known (URL still empty) never ran again once the team arrived — after a
sign-in, the blocks page showed "No locations yet" for a team full of data. Rules for a new
fetch here: put the team id (or anything else the URL depends on) in the key; keep the key
identical across components that should share one call, and set `dedupe: 'defer'` on it:
every owner of a reactive key re-runs it when the key changes, and Nuxt's default `'cancel'`
aborts the others' requests (#3789). Manual refreshes pass `{ dedupe: 'cancel' }` so a save
still gets fresh data. Don't add a `watch:` to paper over a fixed key. Covered by
`test/team-keyed-fetch.test.ts`.

## Testing

Test app at `apps/test-bookings/`:

```bash
cd apps/test-bookings
pnpm crouton generate  # Generate collections
npx nuxt db:generate   # Generate migrations
npx nuxt db:migrate    # Apply migrations
pnpm dev               # Start dev server
```

## Naming Conventions

```
Component: CroutonBooking[Category][Name]
Composable: useBooking[Feature], use[Domain]Settings
API: /api/crouton-bookings/teams/[id]/[resource]
Type: [Domain][Entity] (e.g., BookingWithRelations)
Table: bookings[Collection] (e.g., bookingsBookings)
```

**Capacity guard (#3379):** every booking write (cart batch, `bookings-bookings` POST, both PATCH routes) goes through `server/utils/booking-capacity.ts` — `validateSelection` + one parameter-bounded SQL `guardSql` checked in the writing statement (quantity is a whole number ≥ 1 at every location, default 1; the guard sums quantity of the same product, or product NULL, per requested slot against that product's stock, #4061); the batch is all-or-nothing (`runAtomic`) (D1: one raw `$client.batch` of bound statements — drizzle's `db.batch` can't batch `db.run()` there, #3968; tested in `test/run-atomic-d1.test.ts`). The cart sends `day` (YYYY-MM-DD) so the booked day is the one picked, not the browser's UTC instant.
