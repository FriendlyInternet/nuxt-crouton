export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  collections: [
    { name: 'widgets', fieldsFile: './schemas/widgets.json' }
  ],

  // Target layers (add after creating collections)
  targets: [
    { layer: 'main', collections: ['widgets'] }
  ],

  dialect: 'sqlite'
}
