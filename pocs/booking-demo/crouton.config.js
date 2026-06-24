export default {
  // Feature flags — which crouton packages to enable
  features: {
    bookings: { config: { email: { enabled: false } } }
  },

  // Collections to generate. The bookings trio (booking / location / settings)
  // gives the deterministic layout pass (#709) a calendar-primary surface.
  collections: [
    { name: 'booking', fieldsFile: './schemas/booking.json' },
    { name: 'location', fieldsFile: './schemas/location.json', formComponent: 'CroutonBookingsLocationForm' },
    { name: 'settings', fieldsFile: './schemas/settings.json' }
  ],

  // Target layer
  targets: [
    { layer: 'bookings', collections: ['booking', 'location', 'settings'] }
  ],

  dialect: 'sqlite'
}
