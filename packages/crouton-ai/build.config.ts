import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    // Server utilities - main entry
    {
      input: 'server/utils/index',
      outDir: 'dist/server/utils',
      builder: 'rollup',
      declaration: true
    },
    // Server utilities - providers
    {
      input: 'server/utils/providers',
      outDir: 'dist/server/utils/providers',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    },
    // App composables
    {
      input: 'app/composables',
      outDir: 'dist/app/composables',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    },
    // App types
    {
      input: 'app/types',
      outDir: 'dist/app/types',
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
    'ai',
    '@ai-sdk/vue',
    '@ai-sdk/openai',
    '@ai-sdk/anthropic',
    '@ai-sdk/ui-utils',
    '#imports'
  ]
})
