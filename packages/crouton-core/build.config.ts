import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    {
      input: 'app/composables',
      outDir: 'dist/app/composables',
      builder: 'mkdist',
      pattern: ['**/*.ts'],
      loaders: ['js']
    },
    {
      input: 'server/database/schema',
      outDir: 'dist/server/database/schema',
      builder: 'mkdist',
      pattern: ['**/*.ts'],
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
    'zod'
  ]
})
