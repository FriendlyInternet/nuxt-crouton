import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Vite 8 compiles tests with oxc, which ignores `esbuild.tsconfigRaw` below and
  // reads the nearest tsconfig.json instead. Point it at a test-only tsconfig with
  // no `extends`, so tests don't need `nuxt prepare` to have run.
  tsconfig: './tsconfig.test.json',
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
