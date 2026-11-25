import { defineBuildConfig } from 'unbuild'

// epic #960. Module entry (rollup) + per-dir mkdist runtime entries. The
// source-stamp transform is bundled into the module entry via its import; the
// server dispatcher + sinks build as mkdist files.
export default defineBuildConfig({
  entries: [
    // Module entry point (bundles src/runtime/transform/sourceStamp.ts)
    {
      input: 'src/module.ts',
      outDir: 'dist',
      name: 'module',
      format: 'esm'
    },
    // Runtime server: the /api/_feedback dispatcher + sinks
    {
      input: 'src/runtime/server',
      outDir: 'dist/runtime/server',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    },
    // Client plugins: launcher mount + tool registrations (console)
    {
      input: 'src/runtime/plugins',
      outDir: 'dist/runtime/plugins',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    },
    // Tool registry composable
    {
      input: 'src/runtime/composables',
      outDir: 'dist/runtime/composables',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    },
    // Tool definitions: Console (eruda) factory
    {
      input: 'src/runtime/tools',
      outDir: 'dist/runtime/tools',
      builder: 'mkdist',
      pattern: ['**/*.ts', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['js']
    },
    // Launcher SFC — mkdist compiles the .vue to .mjs (+ .css)
    {
      input: 'src/runtime/components',
      outDir: 'dist/runtime/components',
      builder: 'mkdist',
      pattern: ['**/*.vue', '!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'],
      loaders: ['vue', 'js']
    },
    // Shared overlay mount helper
    {
      input: 'src/runtime/overlay',
      outDir: 'dist/runtime/overlay',
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
    '@vue/compiler-core',
    'h3',
    'nitropack/runtime',
    'vue',
    'nuxt'
  ]
})
