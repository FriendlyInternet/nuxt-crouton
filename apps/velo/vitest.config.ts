import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Velo's own unit tests (pure helpers only, no Nuxt runtime) — #4098.
// Run from the repo root: pnpm exec vitest run --config apps/velo/vitest.config.ts
export default defineConfig({
  // velo's tsconfig extends the generated .nuxt/tsconfig.json, which does not
  // exist before `nuxt prepare` — these tests are plain TS, so skip it.
  oxc: { tsconfig: false },
  test: {
    name: 'velo',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
