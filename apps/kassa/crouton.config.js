export default {
  // Single-language app: Dutch only (no locale switcher / no URL locale prefix)
  locales: ['nl'],
  defaultLocale: 'nl',

  // Feature flags - which crouton packages to enable
  features: {
    sales: { config: { print: { enabled: true } } },
    pages: true
  },

  collections: [],

  targets: [],

  dialect: 'sqlite'
}
