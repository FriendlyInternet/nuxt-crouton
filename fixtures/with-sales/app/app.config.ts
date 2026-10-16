import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

// The sales collections register themselves from @fyit/crouton-sales (#2278).
export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig
  }
})
