// Database schema exports
// This file is auto-managed by crouton-generate

// Export auth schema from crouton-auth package (includes teamSettings, userProfile)
export * from '@fyit/crouton-auth/server/database/schema/auth'
export * from './translations-ui'

// Activity log tables (crouton-events) — the package keeps its schema outside the
// server/db glob, so the app re-exports it for drizzle-kit and NuxtHub.
// Named, not `export *`: NuxtHub 0.10.8 bundles this into a schema.mjs plus a
// rolldown helper chunk for `export *` of an external module, but copies only
// schema.mjs into node_modules/@nuxthub/db — so local dev 500s on the missing chunk.
export { croutonOperations, croutonEvents } from '@fyit/crouton-events/server/database/schema'
