import { defineBuildConfig } from 'unbuild'
import { cpSync } from 'node:fs'

export default defineBuildConfig({
  entries: [
    // Module entry point
    {
      input: 'src/module.ts',
      outDir: 'dist',
      name: 'module',
      format: 'esm'
    },
    // Runtime server files (plugins, middleware, utils)
    {
      input: 'src/runtime/server',
      outDir: 'dist/runtime/server',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    },
    // Runtime RPC files (server handlers)
    {
      input: 'src/runtime/server-rpc',
      outDir: 'dist/runtime/server-rpc',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    }
    // The launcher / Console / Annotate / overlay / transform entries moved to
    // @fyit/crouton-feedback (#960); crouton-devtools installs that module.
  ],
  declaration: true,
  clean: true,
  failOnWarn: false,
  externals: [
    '@nuxt/kit',
    '@nuxt/devtools-kit',
    '@nuxt/schema',
    'h3',
    'vue',
    'nuxt'
  ],
  hooks: {
    'build:done': () => {
      // Copy Vue pages to dist (they can't be transformed by mkdist)
      cpSync('src/runtime/pages', 'dist/runtime/pages', { recursive: true })
      // Copy raw client assets (HTML/CSS/JS) served by the devtools handler
      cpSync('src/runtime/client', 'dist/runtime/client', { recursive: true })
    }
  }
})
