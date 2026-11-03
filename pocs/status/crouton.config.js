export default {
  // Which crouton packages this app uses is decided by `extends` in nuxt.config.ts
  // (#2286). A package's prompted configuration lands under `features.<alias>`.

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
