import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'collections/**/*.api.test.ts'],
    environment: 'node',
    globals: true
  }
})
