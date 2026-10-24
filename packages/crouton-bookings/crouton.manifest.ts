import { defineCroutonManifest, defineGeneratorContribution } from '@fyit/crouton-core/shared/manifest'
import bookingSchema from './schemas/booking.json'
import locationSchema from './schemas/location.json'
import settingsSchema from './schemas/settings.json'
import emailTemplateSchema from './schemas/email-template.json'
import emailLogSchema from './schemas/email-log.json'

export default defineCroutonManifest({
  id: 'crouton-bookings',
  name: 'Booking System',
  description: 'Slot-based and inventory booking with optional email notifications. Perfect for courts, rooms, appointments, equipment rentals, and more.',
  icon: 'i-lucide-calendar',
  version: '1.0.0',
  category: 'miniapp',
  aiHint: 'use when app involves appointments, reservations, or scheduling',

  layer: {
    name: 'bookings',
    editable: false,
    reason: 'Table names are prefixed with "bookings" (e.g., bookingsBookings). This cannot be changed.'
  },

  dependencies: [
    '@fyit/crouton-core',
    '@fyit/crouton-auth'
  ],

  // The collections below ship from this package (collections/*), end to end (#2278).
  // The CLI refuses to generate them into an app; `collections` stays as the
  // package's self-description for AI hints and docs.
  ownsCollections: true,

  collections: [
    {
      name: 'booking',
      tableName: 'bookingsBookings',
      description: 'Individual booking/reservation records with date, slot, location, and customer info.',
      schema: bookingSchema,
      schemaPath: './schemas/booking.json'
    },
    {
      name: 'location',
      tableName: 'bookingsLocations',
      description: 'Bookable venues, resources, or items. Supports time slots or inventory-based booking.',
      schema: locationSchema,
      schemaPath: './schemas/location.json'
    },
    {
      name: 'settings',
      tableName: 'bookingsSettings',
      description: 'Team-wide booking configuration including statuses and age groups.',
      schema: settingsSchema,
      schemaPath: './schemas/settings.json'
    },
    {
      name: 'emailtemplate',
      tableName: 'bookingsEmailtemplates',
      description: 'Email notification templates for booking confirmations, reminders, and follow-ups.',
      schema: emailTemplateSchema,
      schemaPath: './schemas/email-template.json',
      optional: true,
      condition: 'config.email.enabled'
    },
    {
      name: 'emaillog',
      tableName: 'bookingsEmaillogs',
      description: 'Log of sent emails with status tracking.',
      schema: emailLogSchema,
      schemaPath: './schemas/email-log.json',
      optional: true,
      condition: 'config.email.enabled'
    }
  ],

  configuration: {
    'email.enabled': {
      type: 'boolean',
      label: 'Enable Email Notifications',
      description: 'Send booking confirmations, reminders, and follow-ups via email.',
      default: false
    },
    'bookingModes': {
      type: 'multiselect',
      label: 'Booking Modes',
      description: 'How resources can be booked.',
      default: ['slots'],
      options: [
        { value: 'slots', label: 'Time Slots (courts, rooms, appointments)' },
        { value: 'inventory', label: 'Inventory (equipment, tickets, rentals)' }
      ]
    }
  },

  extensionPoints: [
    {
      collection: 'booking',
      allowedFields: ['customData', 'metadata', 'notes'],
      description: 'Add custom fields to booking records for additional data capture.'
    },
    {
      collection: 'location',
      allowedFields: ['customData', 'metadata', 'amenities'],
      description: 'Add custom fields to locations for venue-specific attributes.'
    }
  ],

  provides: {
    composables: [
      'useBookingAvailability',
      'useBookingCart',
      'useBookingEmail',
      'useBookingEmailVariables',
      'useBookingsList',
      'useBookingsSettings',
      'useBookingSlots',
      'useBookingOptions'
    ],
    components: [
      { name: 'CroutonBookingPanel', description: 'Main booking sidebar container', props: ['locationId', 'teamId'] },
      { name: 'CroutonBookingCalendar', description: 'Calendar date picker for booking', props: ['modelValue', 'availableDates'] },
      { name: 'CroutonBookingWeekStrip', description: 'Week date navigation strip', props: ['modelValue', 'startDate'] },
      { name: 'CroutonBookingList', description: 'Bookings list with filters', props: ['teamId', 'filters'] },
      { name: 'CroutonBookingCard', description: 'Individual booking display card', props: ['booking'] },
      { name: 'CroutonBookingSlotIndicator', description: 'Visual slot availability indicator', props: ['slots', 'bookings'] },
      { name: 'CroutonBookingDateBadge', description: 'Date display badge', props: ['date', 'format'] }
    ],
    apiRoutes: [
      '/api/crouton-bookings/teams/[teamId]/availability',
      '/api/crouton-bookings/teams/[teamId]/customer-bookings',
      '/api/crouton-bookings/teams/[teamId]/customer-bookings-batch',
      '/api/crouton-bookings/teams/[teamId]/customer-locations',
      '/api/crouton-bookings/teams/[teamId]/monthly-booking-count',
      '/api/crouton-bookings/teams/[teamId]/bookings/[bookingId]',
      '/api/crouton-bookings/teams/[teamId]/bookings/[bookingId]/resend-email'
    ]
  }
})

// The package ships a bespoke location form (PanelMap-based). Declaring it here
// wires the composable's componentName + skips the generic generated _Form.vue
// for ANY consuming app — no per-app `formComponent` config needed (velo set it
// by hand), and it survives regen. Without this, the maps generator detector
// (location has address + coordinate fields) injects a CroutonMapsMap/useGeocode
// form into a package that doesn't extend crouton-maps → broken codegen (#558).
export const generatorContribution = defineGeneratorContribution({
  getFormComponent({ collectionName }) {
    const forms: Record<string, string> = {
      location: 'CroutonBookingsLocationForm',
      locations: 'CroutonBookingsLocationForm',
    }
    return forms[collectionName] ?? null
  }
})
