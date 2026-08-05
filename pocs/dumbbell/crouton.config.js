export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  collections: [
    { name: 'plates', fieldsFile: './schemas/plates.json' }
  ],

  // Target layers (add after creating collections)
  targets: [
    { layer: 'main', collections: ['plates'] }
  ],

  dialect: 'sqlite'
}
