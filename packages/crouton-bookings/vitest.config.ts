import { defineConfig } from 'vitest/config'

// Day keys are local dates — run in a zone ahead of UTC so a UTC-vs-local mix-up fails (#2724)
process.env.TZ = 'Europe/Brussels'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true
  }
})
