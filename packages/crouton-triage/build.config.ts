import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    // Compile server utilities that are exported for external consumption
    {
      input: 'server/utils',
      outDir: 'dist/server/utils',
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
    'zod',
    '@fyit/crouton',
    '@fyit/crouton-core',
    '@fyit/crouton-auth',
    '@fyit/crouton-ai',
    '@vueuse/core',
    'cheerio'
  ]
})
