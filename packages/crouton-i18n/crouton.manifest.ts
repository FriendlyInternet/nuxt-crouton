import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-i18n',
  name: 'Internationalization',
  description: 'Multi-language support with database-backed translations',
  icon: 'i-lucide-languages',
  version: '1.0.0',
  category: 'core',
  bundled: true,
  dependencies: ['@fyit/crouton-auth'],
  collections: [
    { name: 'translationsUi', tableName: 'translationsUi', description: 'UI translation overrides' },
  ],
  provides: {
    composables: ['useT'],
    components: [
      { name: 'CroutonI18nBlockTranslateTrigger', description: 'Trigger button for translating block-editor fields' },
      { name: 'CroutonI18nInput', description: 'Per-locale input for translatable fields' },
      { name: 'CroutonI18nLanguageSwitcher', description: 'Select menu to switch the current language' },
      { name: 'CroutonI18nListCards', description: 'Translation status badges for an entity' },
      { name: 'TranslationsUiList', description: 'Searchable list of UI translations' },
    ],
  },
})
