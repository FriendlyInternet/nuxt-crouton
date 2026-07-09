// Draft generation plan for the "quotes" POC (issue #1276 — pending sign-off).
// Copy into `pocs/quotes/crouton.config.js` once approved (workstream #1277).
export default {
  features: {
  },

  locales: ['en'],
  defaultLocale: 'en',

  // Single collection: a personal quote keeper.
  collections: [
    { name: 'quote', fieldsFile: './schemas/quote.json' }
  ],

  targets: [
    { layer: 'main', collections: ['quote'] }
  ],

  dialect: 'sqlite'
}
