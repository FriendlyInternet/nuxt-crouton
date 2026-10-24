// Database schema exports
// Aggregates the auth schema (crouton-auth) and UI translations (crouton-i18n)
// so `~~/server/db/schema` resolves the `user` table used across layers.
// The pages table ships from @fyit/crouton-pages (#2278).

// Auth schema from crouton-auth (includes user, teams, teamSettings, userProfile, etc.)
export * from '@fyit/crouton-auth/server/database/schema/auth'
export * from './translations-ui'
