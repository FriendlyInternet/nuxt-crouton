import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {bookingsBookingsConfig} from '../layers/bookings/collections/bookings/app/composables/useBookingsBookings';

import {bookingsLocationsConfig} from '../layers/bookings/collections/locations/app/composables/useBookingsLocations';

import {bookingsSettingsConfig} from '../layers/bookings/collections/settings/app/composables/useBookingsSettings';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    bookingsBookings: bookingsBookingsConfig,
    bookingsLocations: bookingsLocationsConfig,
    bookingsSettings: bookingsSettingsConfig
  }
})