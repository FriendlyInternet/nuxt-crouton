export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Collections to generate (add your collections here)
  collections: [
    { name: 'chores', fieldsFile: './schemas/chores.json' }
  ],

  // Target layers (add after creating collections)
  targets: [
    { layer: 'chores', collections: ['chores'] }
  ],

  dialect: 'sqlite'
}
