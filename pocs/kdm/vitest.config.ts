import { defineConfig } from 'vitest/config'

export default defineConfig({
  // These tests are plain node; don't require `nuxt prepare` (.nuxt/tsconfig.json) to have run,
  // e.g. in CI where install uses --ignore-scripts.
  esbuild: { tsconfigRaw: '{}' },
  test: {
    include: ['layers/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
