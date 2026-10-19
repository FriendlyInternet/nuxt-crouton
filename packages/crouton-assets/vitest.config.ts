import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['app/composables/__tests__/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app/composables/**/*.ts'],
      exclude: ['app/composables/__tests__/**']
    }
  }
})