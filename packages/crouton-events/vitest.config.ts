import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // .vue component tests (#4036); they opt into happy-dom per file
  plugins: [vue()],
  test: {
    include: ['server/**/__tests__/**/*.test.ts', 'app/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: true
  }
})
