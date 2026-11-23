import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [{
    // Editor extensions import their .vue node views; the unit tests only need the schema (#4436)
    name: 'stub-vue-node-views',
    enforce: 'pre',
    load(id) {
      if (id.split('?')[0]!.endsWith('.vue')) return 'export default {}'
    }
  }],
  resolve: {
    alias: {
      // app-level schema is not part of this layer; tests use a stub
      '~~/server/db/schema': fileURLToPath(new URL('./test/stubs/db-schema.ts', import.meta.url)),
      // Nitro virtual module built from the page tree (#4175); tests use a stub
      '#crouton-pages/app-segments': fileURLToPath(new URL('./test/stubs/app-segments.ts', import.meta.url))
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
