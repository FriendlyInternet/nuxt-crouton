export default {
  // Feature flags - which crouton packages to enable
  features: {},

  // Two configured locales so the crouton-i18n LanguageSwitcher has something to
  // switch to. crouton-i18n is bundled by core.
  locales: ['en', 'nl'],
  defaultLocale: 'en',

  // A minimal URL-bookmarking app: one `pins` collection (title / url / note).
  collections: [
    { name: 'pins', fieldsFile: './schemas/pins.json' }
  ],

  targets: [
    { layer: 'main', collections: ['pins'] }
  ],

  dialect: 'sqlite'
}
