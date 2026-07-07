export default {
  // Feature flags — which crouton packages to enable. None for this minimal POC.
  features: {},

  // Two locales so the crouton-i18n LanguageSwitcher (bundled by core) has a target.
  locales: ['en', 'nl'],
  defaultLocale: 'en',

  // A minimal single-collection bookmark keeper: one `bookmarks` collection
  // (title / url / tags / notes). team scoping + createdAt are auto-injected
  // by the generator (not declared in the fieldsFile).
  collections: [
    { name: 'bookmarks', fieldsFile: './schemas/bookmarks.json' }
  ],

  targets: [
    { layer: 'main', collections: ['bookmarks'] }
  ],

  dialect: 'sqlite'
}
