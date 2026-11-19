import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'packages/crouton-core/tests/nuxt-runtime/vitest.config.ts'
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**'
    ],
    coverage: {
      // Nuxt modules/configs are loaded in-process by tests that boot a real
      // Nuxt (#4175); v8 reports -1 branch counts for them, which fallow can't parse.
      // Files a nuxt.config.ts imports are loaded the same way, so the build-time
      // helper is excluded too (it is kept out of app/utils for that reason).
      exclude: [...configDefaults.coverage.exclude, '**/module.ts', '**/nuxt.config.ts', 'apps/**', 'packages/crouton-pages/app-page-segments.ts']
    }
  }
})