import { defineConfig } from 'vitest/config'

// Standalone: the app's tsconfig extends `.nuxt/` (absent without `nuxt prepare`),
// and these tests are pure functions that need no Nuxt.
export default defineConfig({
  oxc: { tsconfig: false } as any,
  test: { include: ['server/**/*.test.ts'] }
})
