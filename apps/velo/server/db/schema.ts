// Database schema exports
// This file is auto-managed by crouton-generate

// Export auth schema from crouton-auth package (includes teamSettings, userProfile)
export * from '@fyit/crouton-auth/server/database/schema/auth'
export * from './translations-ui'

// Activity log tables (crouton-events) — the package keeps its schema outside the
// server/db glob, so the app re-exports it for drizzle-kit and NuxtHub.
export * from '@fyit/crouton-events/server/database/schema'
