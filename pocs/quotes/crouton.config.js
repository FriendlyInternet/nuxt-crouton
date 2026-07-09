// Generation plan for the "quotes" POC — approved on issue #1276 (lgtm).
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
