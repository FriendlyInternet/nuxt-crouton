import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: false,
        esModuleInterop: true,
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
        isolatedModules: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app/composables/**/*.ts', 'server/utils/**/*.ts', 'server/lib/**/*.ts'],
      exclude: ['**/node_modules/**', '**/dist/**']
    },
    setupFiles: ['./tests/setup.ts'],
    typecheck: {
      enabled: false
    }
  },
  resolve: {
    alias: {
      '#app': resolve(__dirname, 'tests/mocks/nuxt-app'),
      '#imports': resolve(__dirname, 'tests/mocks/imports'),
      'nitropack/runtime': resolve(__dirname, 'tests/mocks/nitropack-runtime')
    }
  }
})
