import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

// Parity-only fixture: no app-owned collections. crouton-sales registers its
// own collections via its layer's app.config; this app carries only the
// translationsUi config that every crouton app has.
export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig
  }
})
