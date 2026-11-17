import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // .vue component tests (BoardTree vs the package's LayoutRenderer, #3746)
  plugins: [vue()],
  // `~` = the app dir, so the real BoardPane (imports `~/utils/board-drag`) mounts in tests (#3865).
  resolve: { alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) } },
  test: {
    include: ['layers/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
