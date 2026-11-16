# Required Schemas Reference

This document describes the schemas required by `@fyit/crouton-bookings`.

## Convention Requirement

**CRITICAL**: The package expects tables prefixed with `bookings`. Your crouton config MUST use `bookings` as the layer name:

```javascript
// crouton.config.js
export default {
  targets: [
    { layer: 'bookings', collections: ['bookings', 'locations', 'settings'] }
  ]
}
```

## Core Schemas (Required)

### booking.json

Individual booking records.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | relation (users) | Yes | User who made the booking |
| `location` | relation (locations) | Yes | Location/resource being booked |
| `product` | reference (catalog products) | No | The product this booking is for; not used by the counting yet |
| `date` | date | Yes | Booking date |
| `slot` | text/array | No | Time slot(s) for slot-based bookings |
| `quantity` | number | No | Quantity for inventory-based bookings |
| `status` | select | Yes | Booking status (active, cancelled) |
| `notes` | textarea | No | Optional notes |

**Expected table name**: `bookingsBookings`

### location.json

Venues, resources, or bookable items.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | text | Yes | Display name |
| `description` | textarea | No | Description |
| `address` | text | No | Physical address (for venues) |
| `inventoryMode` | boolean | No | True for inventory-based, false for slot-based |
| `quantity` | number | No | Total quantity (inventory mode only) |
| `maxBookingsPerMonth` | number | No | Max bookings per user per calendar month (null = unlimited) |
| `slots` | json/array | No | Available time slots (slot mode only) |
| `products` | repeater | No | Products this location offers, each with its own stock (`[{ product, stock }]`); not used by the counting yet |
| `slotGroups` | json | No | Grouped time slots with colors |
| `accessControl` | select | No | Who can book (public, members, team) |
| `isActive` | boolean | Yes | Whether location is bookable |

**Expected table name**: `bookingsLocations`

### settings.json

Team-wide booking configuration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bookingWindow` | number | No | Days in advance bookings allowed |
| `maxBookingsPerDay` | number | No | Max bookings per user per day |
| `cancellationPolicy` | textarea | No | Cancellation policy text |
| `requireApproval` | boolean | No | Whether bookings need admin approval |

**Expected table name**: `bookingsSettings`

## Optional Schemas (Email Module)

Only needed if using the email module (`croutonBookings.email.enabled = true`).

### email-template.json

Email templates for booking notifications.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | text | Yes | Template name |
| `subject` | text | Yes | Email subject line |
| `body` | richtext | Yes | Email body (supports variables) |
| `triggerType` | select | Yes | When to send (booking_confirmed, reminder_before, booking_cancelled, follow_up_after) |
| `recipientType` | select | Yes | Who receives (customer, admin, both) |
| `locationId` | relation (locations) | No | Specific location (null = all locations) |
| `isActive` | boolean | Yes | Whether template is active |

**Expected table name**: `bookingsEmailtemplates`

### email-log.json

Log of sent emails.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bookingId` | relation (bookings) | Yes | Related booking |
| `templateId` | relation (emailtemplates) | Yes | Template used |
| `recipient` | text | Yes | Email recipient |
| `status` | select | Yes | Delivery status (pending, sent, failed) |
| `sentAt` | datetime | No | When email was sent |
| `error` | text | No | Error message if failed |

**Expected table name**: `bookingsEmaillogs`

## Template Variables

Email templates support these variables:

| Variable | Description |
|----------|-------------|
| `{{customer_name}}` | Booking owner's name |
| `{{customer_email}}` | Booking owner's email |
| `{{booking_date}}` | Formatted booking date |
| `{{booking_slot}}` | Time slot(s) |
| `{{location_name}}` | Location name |
| `{{location_address}}` | Location address |
| `{{team_name}}` | Team name |

## Sample crouton.config.js

### Basic (Without Email)

```javascript
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

### With Email Module

```javascript
export default {
  collections: [
    { name: 'bookings', fieldsFile: './schemas/booking.json' },
    { name: 'locations', fieldsFile: './schemas/location.json' },
    { name: 'settings', fieldsFile: './schemas/settings.json' },
    { name: 'emailtemplates', fieldsFile: './schemas/email-template.json' },
    { name: 'emaillogs', fieldsFile: './schemas/email-log.json' }
  ],
  targets: [
    { layer: 'bookings', collections: ['bookings', 'locations', 'settings', 'emailtemplates', 'emaillogs'] }
  ],
  dialect: 'sqlite'
}
```

## Inventory Mode vs Slot Mode

### Slot Mode (Default)

Location with fixed time slots:

```json
{
  "name": "Tennis Court A",
  "inventoryMode": false,
  "slots": ["08:00", "09:00", "10:00", "11:00", "12:00"]
}
```

Bookings reference specific slots:

```json
{
  "location": "court-a",
  "date": "2024-01-15",
  "slot": ["09:00"]
}
```

### Inventory Mode

Location with quantity-based availability:

```json
{
  "name": "Rental Bikes",
  "inventoryMode": true,
  "quantity": 20
}
```

Bookings specify quantity:

```json
{
  "location": "rental-bikes",
  "date": "2024-01-15",
  "quantity": 3
}
```
