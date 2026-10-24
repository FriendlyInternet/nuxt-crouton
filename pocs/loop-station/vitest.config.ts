import { defineConfig } from 'vitest/config'

// Pure view-model logic only (app/utils/*); components render in the deployed preview.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
})
