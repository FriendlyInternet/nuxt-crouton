export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  collections: [
    { name: 'cogs', fieldsFile: './schemas/cogs.json' }
  ],

  // Target layers (add after creating collections)
  targets: [
    { layer: 'sprocket', collections: ['cogs'] }
  ],

  dialect: 'sqlite'
}
