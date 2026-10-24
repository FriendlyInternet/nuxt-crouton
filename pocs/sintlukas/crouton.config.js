export default {
  features: {
    pages: true
  },

  collections: [
    { name: 'categories', fieldsFile: './schemas/categories.json', seed: true },
    { name: 'ateliers', fieldsFile: './schemas/ateliers.json', kind: 'content', seed: true },
    { name: 'persons', fieldsFile: './schemas/persons.json', seed: true },
    { name: 'locations', fieldsFile: './schemas/locations.json', seed: true },
    { name: 'news', fieldsFile: './schemas/news.json', kind: 'content', seed: true },
    { name: 'downloads', fieldsFile: './schemas/downloads.json', seed: true }
  ],

  targets: [
    { layer: 'content', collections: ['categories', 'ateliers', 'persons', 'locations', 'news', 'downloads'] }
  ],

  dialect: 'sqlite'
}
