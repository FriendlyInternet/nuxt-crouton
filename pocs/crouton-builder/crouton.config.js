export default {
  // The graduated Crouton Builder app (epic #983, A3 data model).
  // Three real collections replace the POC's backend-free demo blocks:
  //   pages    — the Site flow sitemap (hierarchy via parentId) + each page's builder board
  //   artists  — content the builder arranges (list variants / form / stats blocks)
  //   bookings — content for the chart block (bookings per week), ref → artists
  collections: [
    { name: 'pages', fieldsFile: './schemas/pages.json', hierarchy: true },
    { name: 'artists', fieldsFile: './schemas/artists.json' },
    { name: 'bookings', fieldsFile: './schemas/bookings.json' }
  ],

  // Target layer — one 'builder' domain layer holds all three
  targets: [
    { layer: 'builder', collections: ['pages', 'artists', 'bookings'] }
  ],

  dialect: 'sqlite'
}
