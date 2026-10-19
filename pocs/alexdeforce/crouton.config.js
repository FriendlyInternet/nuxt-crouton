export default {
  features: {
    pages: true
  },

  collections: [
    { name: 'articles', fieldsFile: './schemas/articles.json', kind: 'content', seed: true },
    { name: 'tags', fieldsFile: './schemas/tag.json', seed: true },
    { name: 'categories', fieldsFile: './schemas/category.json', seed: true },
    { name: 'agenda', fieldsFile: './schemas/agenda.json', kind: 'content', seed: true }
  ],

  targets: [
    { layer: 'content', collections: ['articles', 'agenda', 'tags', 'categories'] }
  ],

  dialect: 'sqlite'
}
