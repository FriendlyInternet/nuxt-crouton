export default {
  // Feature flags - which crouton packages to enable.
  // `maps: true` wires @fyit/crouton-maps into the extends; the map + geocoding
  // form is auto-injected because the `locations` collection has address +
  // coordinate fields (the crouton-maps generator detector fires on them).
  features: {
    maps: {
      "config": {
        "style": "liberty",
        "geocodingUrl": "https://nominatim.openstreetmap.org"
      }
    }
  },

  // Single locale — this fixture exercises maps, not i18n locale-switching.
  locales: ['en'],
  defaultLocale: 'en',

  // `items`: a generic collection for plain list + CRUD.
  // `venues`: address + `coordinates` fields → the maps generator injects the
  //   CroutonMapsMap picker + useGeocode auto-geocoding into the form, and the
  //   CroutonMapsPreview cell into the list. (Named "venues", not "locations":
  //   the crouton-sales manifest reserves "location(s)" for its own bespoke form.)
  collections: [
    { name: 'items', fieldsFile: './schemas/items.json' },
    { name: 'venues', fieldsFile: './schemas/venues.json' }
  ],

  targets: [
    { layer: 'main', collections: ['items', 'venues'] }
  ],

  dialect: 'sqlite'
}
