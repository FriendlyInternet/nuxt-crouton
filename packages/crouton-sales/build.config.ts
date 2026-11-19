import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    // Compile TypeScript composables and utils
    {
      input: 'app/composables',
      outDir: 'dist/app/composables',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    },
    {
      input: 'server/utils',
      outDir: 'dist/server/utils',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    }
  ],
  declaration: true,
  clean: true,
  failOnWarn: false,
  externals: [
    '@nuxt/kit',
    '@nuxt/schema',
    'h3',
    'vue',
    'nuxt',
    'zod',
    '@fyit/crouton'
  ]
})
