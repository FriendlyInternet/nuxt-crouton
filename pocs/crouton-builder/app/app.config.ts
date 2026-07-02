import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {builderPagesConfig} from '../layers/builder/collections/pages/app/composables/useBuilderPages';

import {builderArtistsConfig} from '../layers/builder/collections/artists/app/composables/useBuilderArtists';

import {builderBookingsConfig} from '../layers/builder/collections/bookings/app/composables/useBuilderBookings';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    builderPages: builderPagesConfig,
    builderArtists: builderArtistsConfig,
    builderBookings: builderBookingsConfig
  }
})