export default {
  // No optional crouton packages beyond the core bundle (auth + admin).
  // links is a minimal collection POC — no extra features required.
  features: {},

  // links POC collections — generated via the crouton CLI (`crouton config`).
  // NOTE: do NOT run crouton config until this schema is approved (#314).
  collections: [
    { name: 'links', fieldsFile: './schemas/links.json', kind: 'content' }
  ],

  targets: [
    { layer: 'links', collections: ['links'] }
  ],

  dialect: 'sqlite'
}
