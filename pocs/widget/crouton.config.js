export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  // Example:
  // collections: [
  //   { name: 'products', fieldsFile: './schemas/products.json' }
  // ],
  collections: [
    { name: 'parts', fieldsFile: './schemas/parts.json' }
  ],

  // Target layers (add after creating collections)
  // Example:
  // targets: [
  //   { layer: 'shop', collections: ['products'] }
  // ],
  targets: [
    { layer: 'widget', collections: ['parts'] }
  ],

  dialect: 'sqlite'
}
