import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'app/composables/__tests__/**/*.test.ts',
      'server/utils/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
    ],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'app/composables/**/*.ts',
        'server/utils/**/*.ts',
      ],
      exclude: [
        'app/composables/__tests__/**',
        'server/utils/__tests__/**',
      ],
    },
  },
})
