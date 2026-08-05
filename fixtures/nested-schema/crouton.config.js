export default {
  // Parity-only fixture (WS1a #1446) — no generated collections. It exists so
  // the schema-source resolver's parity suite can assert the nesting-only edge
  // (crouton-printing reachable solely via the transitive sales -> printing
  // extends). The resolver reads the filesystem extends graph, never this file.
  features: {},

  locales: ['en'],
  defaultLocale: 'en',

  collections: [],
  targets: [],

  dialect: 'sqlite'
}
