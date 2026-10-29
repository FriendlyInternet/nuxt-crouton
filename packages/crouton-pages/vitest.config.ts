import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // app-level schema is not part of this layer; tests use a stub
      '~~/server/db/schema': fileURLToPath(new URL('./test/stubs/db-schema.ts', import.meta.url))
    }
  },
  define: {
    'import.meta.server': false
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app/utils/**/*.ts'],
      exclude: ['test/**', 'app/types/**']
    }
  }
})
