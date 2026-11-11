import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'packages/crouton-core/tests/nuxt-runtime/vitest.config.ts',
      'packages/crouton-layout/tests/nuxt-runtime/vitest.config.ts'
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**'
    ]
  }
})