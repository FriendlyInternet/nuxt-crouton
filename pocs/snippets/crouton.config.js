export default {
  // Feature flags - which crouton packages to enable
  features: {},

  // Two configured locales so the crouton-i18n LanguageSwitcher has something to
  // switch to. crouton-i18n is bundled by core.
  locales: ['en', 'nl'],
  defaultLocale: 'en',

  // A minimal code-snippet keeper: one `snippet` collection
  // (title / code / language / tags).
  collections: [
    { name: 'snippet', fieldsFile: './schemas/snippet.json' }
  ],

  targets: [
    { layer: 'main', collections: ['snippet'] }
  ],

  dialect: 'sqlite'
}
