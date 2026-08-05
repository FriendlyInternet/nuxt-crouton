import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import { mainPinsConfig } from '../layers/main/collections/pins/app/composables/useMainPins';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainPins: mainPinsConfig
  }
})
