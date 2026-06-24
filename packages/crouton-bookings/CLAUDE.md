# CLAUDE.md - @fyit/crouton-bookings

## Package Purpose

Booking system layer for Nuxt applications that provides both slot-based bookings (courts, rooms, appointments) and inventory-based reservations (equipment, rentals). Works as a Nuxt layer that integrates with `@fyit/crouton` and `@fyit/crouton-auth`.

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer configuration, component registration, i18n setup |
| `app/composables/useBookingAvailability.ts` | Check slot/inventory availability |
| `app/composables/useBookingCart.ts` | Shopping cart for bookings |
| `app/composables/useBookingsSettings.ts` | Team booking settings |
| `app/composables/useBookingEmail.ts` | Email functionality (opt-in) |
| `app/composables/useBookingEmailVariables.ts` | Email template variables + demo data for previews |
| `app/pages/dashboard/[team]/settings/email-templates.vue` | Email template management page |
| `app/types/booking.ts` | TypeScript type definitions |
| `server/api/crouton-bookings/` | API endpoints |
| `server/utils/booking-emails.ts` | Email utilities |
| `schemas/` | JSON schema definitions |

## Architecture

### Components (Prefixed: CroutonBooking)

```
CroutonBooking
├── Slot/
│   └── Indicator.vue   - Visual slot indicator
├── Panel.vue           - Main booking sidebar (CroutonBookingsPanel; self-fetches via useBookingsList)
├── LayoutCalendar.vue  - CroutonBookingsLayoutCalendar: the calendar as a placeable layout block (#709), registered in croutonLayoutBlocks as `bookings-calendar` (compound, minWidth 520). Wraps CroutonBookingsPanel; the deterministic layout pass picks it → calendar-primary.
├── Calendar.vue        - Calendar date picker
├── List.vue            - Bookings list
├── BookingCard.vue     - Individual booking card
├── BookingCreateCard.vue - Booking creation form
├── WeekStrip.vue       - Week date navigation
├── DateBadge.vue       - Date display badge
├── PanelFilters.vue    - Filter controls
└── PanelMap.vue        - Map display
```

### API Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/api/crouton-bookings/teams/[id]/availability` | GET | Get booked slots for date range |
| `/api/crouton-bookings/teams/[id]/customer-bookings` | GET | Get user's bookings with email stats |
| `/api/crouton-bookings/teams/[id]/customer-bookings-batch` | POST | Submit cart (batch checkout) |
| `/api/crouton-bookings/teams/[id]/customer-locations` | GET | Get accessible locations |
| `/api/crouton-bookings/teams/[id]/monthly-booking-count` | GET | Get user's monthly booking count for a location |
| `/api/crouton-bookings/teams/[id]/bookings/[bookingId]` | PATCH | Update a booking (any team member) |
| `/api/crouton-bookings/teams/[id]/bookings/[bookingId]/resend-email` | POST | Resend email (if enabled) |

### Booking Modes

1. **Slot Mode** (default): Named time slots with optional per-slot capacity
   - Each slot has `{ id, label, capacity? }` — capacity defaults to 1
   - `capacity: 4` means 4 people can book the same slot on the same date
   - UI shows "X left" / "Full" badges when capacity > 1
2. **Inventory Mode**: Quantity-based like `{ quantity: 20 }` — no named slots

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton',
    '@fyit/crouton-auth',
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
3. Use Composition API with `<script setup lang="ts">`

### Add a New API Endpoint

1. Create in `server/api/crouton-bookings/teams/[id]/endpoint.get.ts`
2. Use `defineEventHandler`
3. Import utilities from consuming app context (layer pattern)

### Modify Availability Logic

1. Edit `app/composables/useBookingAvailability.ts`
2. Functions: `getSlotAvailability()`, `getInventoryAvailability()`
3. Handles both slot and inventory modes

### Customize Email Behavior

1. Edit `server/utils/booking-emails.ts` for utilities
2. Apps override `resend-email.post.ts` for custom logic
3. Email module is opt-in via `croutonBookings.email.enabled`

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

- **Required**: `@fyit/crouton`, `@fyit/crouton-auth`
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
