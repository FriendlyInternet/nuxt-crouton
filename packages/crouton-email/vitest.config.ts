import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Renders the server/emails/*.vue templates in plain Node (no Nuxt): the same
// @vitejs/plugin-vue the Nitro bundle uses, so what the test renders is what ships.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.nuxt/**'],
  },
})
