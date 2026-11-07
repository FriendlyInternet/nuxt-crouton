import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#build/crouton-collection-forms.mjs': resolve(import.meta.dirname, 'app/components/__tests__/mocks/collection-forms.ts')
    }
  },
  test: {
    include: [
      'app/components/__tests__/**/*.test.ts',
      'app/composables/__tests__/**/*.test.ts',
      'app/utils/__tests__/**/*.test.ts',
      'server/utils/__tests__/**/*.test.ts',
      'tests/**/*.test.ts'
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**'
    ],
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