import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['layers/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
