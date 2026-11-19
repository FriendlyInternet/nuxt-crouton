import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Inline tsconfig: the real one extends the generated .nuxt/tsconfig.json, which
  // doesn't exist in a --ignore-scripts install (CI plan-checks), failing every test.
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        isolatedModules: true,
      },
    },
  },
  test: {
    include: ['layers/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
