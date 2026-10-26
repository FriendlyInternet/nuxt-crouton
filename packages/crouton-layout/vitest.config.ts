import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    include: [
      'app/utils/__tests__/**/*.test.ts',
      'app/composables/__tests__/**/*.test.ts',
      'app/components/__tests__/**/*.test.ts',
      'server/**/__tests__/**/*.test.ts'
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
      include: ['app/utils/**/*.ts', 'app/composables/**/*.ts'],
      exclude: ['app/**/__tests__/**']
    }
  }
})
