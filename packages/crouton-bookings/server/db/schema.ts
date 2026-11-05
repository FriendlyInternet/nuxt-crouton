// Database schema exports
// This file is auto-managed by crouton-generate

// Export auth schema from crouton-auth package
export * from '@fyit/crouton-auth/server/database/schema/auth'

// The bookings collection tables (#2278) — owned by this package, so an app's
// migrations pick them up from here, not from a generated app layer.
export { bookingsBookings } from '../../collections/bookings/server/database/schema'
export { bookingsLocations } from '../../collections/locations/server/database/schema'
export { bookingsSettings } from '../../collections/settings/server/database/schema'
export { bookingsEmailtemplates } from '../../collections/emailtemplates/server/database/schema'
export { bookingsEmaillogs } from '../../collections/emaillogs/server/database/schema'
