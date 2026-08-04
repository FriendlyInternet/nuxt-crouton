export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  collections: [
    { name: 'awards', fieldsFile: './schemas/awards.json' }
  ],

  // Target layers (add after creating collections)
  targets: [
    { layer: 'main', collections: ['awards'] }
  ],

  dialect: 'sqlite'
}
