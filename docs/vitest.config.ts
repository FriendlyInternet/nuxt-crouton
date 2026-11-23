import { defineConfig } from 'vitest/config'

export default defineConfig({
  // docs/tsconfig.json extends the generated .nuxt/tsconfig.json, which only exists after
  // `nuxt prepare` (CI never runs it for docs). Vite's oxc transform resolves the nearest
  // tsconfig per file, so server/utils/*.ts imported by tests would hit the missing file.
  // Pin the standalone one for every file this project compiles.
  tsconfig: 'tests/tsconfig.json',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
})
