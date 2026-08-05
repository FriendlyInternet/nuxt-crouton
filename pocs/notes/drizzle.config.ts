import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

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
