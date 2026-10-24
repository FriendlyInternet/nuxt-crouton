export default {
  // Feature flags — which crouton packages to enable
  features: {
    bookings: { config: { email: { enabled: false } } }
  },

  // Collections to generate. The bookings trio (booking / location / settings)
  // gives the deterministic layout pass (#709) a calendar-primary surface.
  collections: [
  ],

  // Target layer
  targets: [
  ],

  dialect: 'sqlite'
}
