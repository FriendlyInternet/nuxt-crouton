import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// NuxtHub writes the bundled drizzle schema to the Nuxt buildDir after a build.
// That's `.nuxt/` for some apps, but `node_modules/.cache/nuxt/.nuxt` when the
// build uses the cache buildDir. Resolve whichever exists so `pnpm db:generate`
// works without hand-editing the path.
const schemaCandidates = [
  '.nuxt/hub/db/schema.mjs',
  'node_modules/.cache/nuxt/.nuxt/hub/db/schema.mjs',
]
const schema = schemaCandidates.find(p => existsSync(p)) ?? schemaCandidates[0]

export default defineConfig({
  dialect: 'sqlite',
  schema,
  out: 'server/db/migrations/sqlite',
})
