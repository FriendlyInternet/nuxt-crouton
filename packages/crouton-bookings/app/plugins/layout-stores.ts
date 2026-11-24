/**
 * Registers the `bookings` layout store (#3651), so a composed layout's
 * `bookings-list` / `bookings-filters` / `bookings-locations` leaves with
 * `source: 'bookings'` are fed from one shared copy.
 */
import { bookingsLayoutStore } from '../utils/bookings-layout-store'

export default defineNuxtPlugin(() => {
  defineCroutonLayoutStore(bookingsLayoutStore)
})
