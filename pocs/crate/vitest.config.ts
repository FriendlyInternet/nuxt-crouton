import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Nuxt's `~~` (project root) alias, so tests can import server code that uses it.
    alias: { '~~': fileURLToPath(new URL('.', import.meta.url)) }
  },
  test: {
    include: ['layers/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
