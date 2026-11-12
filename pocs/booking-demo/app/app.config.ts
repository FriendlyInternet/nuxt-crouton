import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'




export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
  },
  // The tiny test block behind /layout-store-check (#3650); merges with the
  // blocks the layers register.
  croutonLayoutBlocks: {
    'store-check-counter': {
      id: 'store-check-counter',
      name: 'Store check counter',
      description: 'Test block fed by the `test` layout store (#3650)',
      icon: 'i-lucide-hash',
      component: 'StoreCheckCounter',
      kind: 'atomic',
      minWidth: 120,
    },
  },
})
