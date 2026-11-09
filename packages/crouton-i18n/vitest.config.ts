import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    include: ['app/composables/__tests__/**/*.test.ts', 'server/**/__tests__/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app/composables/**/*.ts'],
      exclude: ['app/composables/__tests__/**']
    }
  },
  resolve: {
    alias: { '#imports': resolve(import.meta.dirname, 'server/__tests__/helpers/imports-stub.ts') }
  }
})
