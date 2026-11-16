export default {
  // Feature flags - which crouton packages to enable
  features: {
  },

  // Relations e2e fixture (#224): two app collections linked by a foreign key,
  // so the generator's relationship handling (refTarget FK column, multi-table
  // migration, CroutonFormReferenceSelect loading options from the parent
  // collection) is generated and smoked end to end. The FK stays optional so the
  // text-field-only CRUD harness can create products without picking a category.
  collections: [
    { name: 'categories', fieldsFile: './schemas/categories.json' },
    { name: 'products', fieldsFile: './schemas/products.json' }
  ],

  targets: [
    { layer: 'main', collections: ['categories', 'products'] }
  ],

  dialect: 'sqlite'
}
