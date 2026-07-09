export default {
  // Feature flags - which crouton packages to enable
  features: {},

  // Two configured locales so the crouton-i18n LanguageSwitcher has something to
  // switch to. crouton-i18n is bundled by core.
  locales: ['en', 'nl'],
  defaultLocale: 'en',

  // A minimal notes app: one `notes` collection (title / body / tags).
  collections: [
    { name: 'notes', fieldsFile: './schemas/notes.json' }
  ],

  targets: [
    { layer: 'main', collections: ['notes'] }
  ],

  dialect: 'sqlite'
}
