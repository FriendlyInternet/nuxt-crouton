import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Day keys are local dates — run in a zone ahead of UTC so a UTC-vs-local mix-up fails (#2724)
process.env.TZ = 'Europe/Brussels'

export default defineConfig({
  // Lets a test mount a layout block (#3651); such a file opts into happy-dom itself.
  plugins: [vue()],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true
  }
})
