export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  collections: [
    { name: 'items', fieldsFile: './schemas/items.json' }
  ],

  // Target layers (add after creating collections)
  targets: [
    { layer: 'trinket', collections: ['items'] }
  ],

  dialect: 'sqlite'
}
