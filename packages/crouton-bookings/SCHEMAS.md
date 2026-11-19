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
| `product` | reference (catalog products) | No | The product this booking is for; always set by the server (the location's only product when none is sent); counted against that product's stock (#4061) |
| `date` | date | Yes | Booking date |
| `slot` | text/array | No | Time slot(s) for slot-based bookings |
| `quantity` | number | No | How many units of the booking's product (whole number ≥ 1, default 1), at every location |
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
| `maxBookingsPerMonth` | number | No | Max bookings per user per calendar month (null = unlimited) |
| `slots` | json/array | No | Available time slots (empty = booked for the whole day) |
| `offerFullDay` | boolean | No | Offer a full-day choice next to the slots |
| `products` | repeater | No | Products this location offers, each with its own stock (`[{ product, stock }]`); saved without products → the server gives it one product of its own (`loc-<id>`); each product's `stock` is what the counting uses, per day and per slot |
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

## Locations with and without slots

A location with named `slots` is booked per slot; with an empty `slots` list it is booked for the whole day. How many fit is each product's `stock` (see `products`).
