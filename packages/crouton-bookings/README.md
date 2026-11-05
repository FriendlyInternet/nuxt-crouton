# @fyit/crouton-bookings

A booking system layer for Nuxt applications. Supports both **slot-based bookings** (courts, rooms, time slots) and **inventory-based reservations** (equipment, rentals).

## Installation

```bash
pnpm add @fyit/crouton-bookings
```

## Quick Start

### 1. Extend your Nuxt config

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',  // bundles crouton-auth
    '@fyit/crouton-bookings',
    './layers/bookings' // Your generated layer
  ],
  // ... other config
})
```

### 2. Create schemas

Copy the schemas from `node_modules/@fyit/crouton-bookings/schemas/` to your `schemas/` directory, or create your own based on the reference schemas.

**Required schemas:**
- `booking.json` - Individual bookings
- `location.json` - Venues/resources
- `settings.json` - Booking configuration

### 3. Configure crouton

```javascript
// crouton.config.js
export default {
  collections: [
    { name: 'bookings', fieldsFile: './schemas/booking.json' },
    { name: 'locations', fieldsFile: './schemas/location.json' },
    { name: 'settings', fieldsFile: './schemas/settings.json' }
  ],
  targets: [
    { layer: 'bookings', collections: ['bookings', 'locations', 'settings'] }
  ],
  dialect: 'sqlite'
}
```

### 4. Generate and migrate

```bash
pnpm crouton generate
npx nuxt db:generate
npx nuxt db:migrate
```

## Convention Requirements

**IMPORTANT**: The package expects tables prefixed with `bookings`. Your layer MUST be named `bookings` in `crouton.config.js`.

| Schema | Expected Table Name |
|--------|---------------------|
| `booking.json` | `bookingsBookings` |
| `location.json` | `bookingsLocations` |
| `settings.json` | `bookingsSettings` |

## Components

All components are prefixed with `CroutonBooking`:

### Customer-Facing
- `CroutonBookingDateBadge` - Date display badge
- `CroutonBookingBookingSidebarPanel` - Main booking sidebar
- `CroutonBookingBookingSidebarForm` - Booking form
- `CroutonBookingBookingSidebarCart` - Shopping cart
- `CroutonBookingBookingSidebarMyBookings` - User's bookings list
### Admin
- `CroutonBookingAdminCalendar` - Admin booking calendar
- `CroutonBookingAdminSlotSelect` - Slot selection for admin
- `CroutonBookingAdminCard` - Admin booking card
- `CroutonBookingSlotIndicator` - Visual slot indicator
- `CroutonBookingSlotSingleIndicator` - Single slot indicator

## Composables

### useBookingAvailability

Get availability for a location on specific dates.

```typescript
const { bookedSlots, getAvailabilityForDate, isSlotBooked } = useBookingAvailability({
  teamId: 'team-123',
  locationId: 'location-456',
  dateRange: { start: new Date(), end: new Date() }
})
```

### useBookingCart

Manage the booking cart.

```typescript
const {
  items,
  addItem,
  removeItem,
  clearCart,
  checkout,
  isSubmitting
} = useBookingCart({ teamId: 'team-123' })
```

### useBookingsSettings

Access team booking settings.

```typescript
const { settings, refresh } = useBookingsSettings({ teamId: 'team-123' })
```

### useBookingEmail

Email functionality (opt-in).

```typescript
const { isEmailEnabled, resendEmail } = useBookingEmail()
```

## Booking Modes

### Slot-Based (Default)

For resources with fixed time slots (courts, rooms, appointments):

```json
{
  "inventoryMode": false,
  "slots": ["09:00", "10:00", "11:00", "12:00"]
}
```

### Inventory-Based

For resources tracked by quantity (equipment rentals, tickets):

```json
{
  "inventoryMode": true,
  "quantity": 10
}
```

## Email Module (Optional)

Enable email notifications by setting:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
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

Also requires:
- `@fyit/crouton-email` package
- Email template and log schemas (optional)

See [SCHEMAS.md](./SCHEMAS.md) for email schema details.

## API Endpoints

The package provides these API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/crouton-bookings/teams/[id]/availability` | GET | Get booked slots for date range |
| `/api/crouton-bookings/teams/[id]/customer-bookings` | GET | Get user's bookings |
| `/api/crouton-bookings/teams/[id]/customer-bookings-batch` | POST | Submit cart (batch booking) |
| `/api/crouton-bookings/teams/[id]/customer-locations` | GET | Get locations accessible to user |
| `/api/crouton-bookings/teams/[id]/monthly-booking-count` | GET | Get user's monthly booking count for a location |
| `/api/crouton-bookings/teams/[id]/bookings/[bookingId]/resend-email` | POST | Resend booking email (if email enabled) |

## i18n

The package includes translations for:
- English (`en`)
- Dutch (`nl`)

Translations are automatically merged when extending the layer.

## License

MIT
