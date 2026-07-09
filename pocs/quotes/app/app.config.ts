import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

import {mainQuotesConfig} from '../layers/main/collections/quotes/app/composables/useMainQuotes';

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
    mainQuotes: mainQuotesConfig
  }
})