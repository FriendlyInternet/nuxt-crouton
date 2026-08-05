export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  collections: [
    { name: 'levers', fieldsFile: './schemas/levers.json' }
  ],

  // Target layers (add after creating collections)
  targets: [
    { layer: 'cranklet', collections: ['levers'] }
  ],

  dialect: 'sqlite'
}
