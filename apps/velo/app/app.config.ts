import { translationsUiConfig } from '@fyit/crouton-i18n/app/composables/useTranslationsUi'

export default defineAppConfig({
  croutonCollections: {
    translationsUi: translationsUiConfig,
  },
  // "Assistants IA" in the admin side menu → /admin/<team>/assistants (#4098)
  croutonApps: {
    assistants: {
      id: 'assistants',
      name: 'assistants.title',
      icon: 'i-lucide-bot',
      adminRoutes: [
        { path: '/assistants', label: 'assistants.title', icon: 'i-lucide-bot' }
      ]
    }
  }
})
