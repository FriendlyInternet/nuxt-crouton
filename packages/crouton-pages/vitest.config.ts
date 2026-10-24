import { defineConfig } from 'vitest/config'

export default defineConfig({
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
