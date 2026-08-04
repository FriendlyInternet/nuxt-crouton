export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  collections: [
    { name: 'loans', fieldsFile: './schemas/loans.json' }
  ],

  // Target layers (add after creating collections)
  targets: [
    { layer: 'lend', collections: ['loans'] }
  ],

  dialect: 'sqlite'
}
