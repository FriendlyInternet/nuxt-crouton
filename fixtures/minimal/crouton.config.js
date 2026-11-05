export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Two configured locales so the e2e harness has something to switch *to*:
  // the i18n smoke flips locale via the crouton-i18n LanguageSwitcher and asserts
  // a known UI string changes language. crouton-i18n is already bundled by core,
  // so a separate with-i18n fixture would be redundant (#168) — this makes the
  // i18n behaviour observable on `minimal` instead (#208).
  locales: ['en', 'nl'],
  defaultLocale: 'en',

  // Minimal e2e fixture: one simple collection to exercise list + CRUD
  collections: [
    { name: 'items', fieldsFile: './schemas/items.json' },
    // Access-declaration fixtures (#3148): drive e2e/access.smoke.spec.ts
    { name: 'admindocs', fieldsFile: './schemas/admindocs.json', hierarchy: true, access: { create: 'admin', reorder: 'admin' } },
    { name: 'membernotes', fieldsFile: './schemas/membernotes.json', access: { create: 'member', list: 'own' } }
  ],

  targets: [
    { layer: 'main', collections: ['items', 'admindocs', 'membernotes'] }
  ],

  dialect: 'sqlite'
}
