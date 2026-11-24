export default {
  // Which crouton packages this app uses is decided by `extends` in nuxt.config.ts
  // (#2286). A package's prompted configuration lands under `features.<alias>`.

  // Collections to generate (add your collections here)
  // Example:
  // collections: [
  //   { name: 'products', fieldsFile: './schemas/products.json' }
  // ],
  collections: [
    { name: 'cards', fieldsFile: './schemas/cards.json' },
    // sortable adds the `order` column the board's kanban sorts by (a system field, not in the schema)
    { name: 'items', fieldsFile: './schemas/items.json', sortable: true }
  ],

  // Target layers (add after creating collections)
  // Example:
  // targets: [
  //   { layer: 'shop', collections: ['products'] }
  // ],
  targets: [
    { layer: 'inbox', collections: ['cards'] },
    { layer: 'pipeline', collections: ['items'] }
  ],

  dialect: 'sqlite'
}
