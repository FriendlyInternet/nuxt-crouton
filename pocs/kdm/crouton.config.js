export default {
  // Which crouton packages this app uses is decided by `extends` in nuxt.config.ts
  // (#2286). A package's prompted configuration lands under `features.<alias>`.

  // One language: the site is not translated, so the editor shows no language
  // selector and, with hideLocaleInUrl, public addresses carry no locale.
  locales: ['en'],
  defaultLocale: 'en',

  // Collections to generate (add your collections here)
  // Example:
  // collections: [
  //   { name: 'products', fieldsFile: './schemas/products.json' }
  // ],
  collections: [],

  // Target layers (add after creating collections)
  // Example:
  // targets: [
  //   { layer: 'shop', collections: ['products'] }
  // ],
  targets: [],

  dialect: 'sqlite'
}
