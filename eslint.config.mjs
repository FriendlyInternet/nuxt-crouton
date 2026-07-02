// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'
import pluginVueA11y from 'eslint-plugin-vuejs-accessibility'

/**
 * Root ESLint config for the nuxt-crouton monorepo.
 *
 * - Apps (apps/*) have their own eslint.config.mjs using @nuxt/eslint module
 * - Packages (packages/*) are linted by this root config
 * - Uses ESLint Stylistic for formatting (no Prettier needed)
 *
 * @see https://eslint.nuxt.com/packages/config
 */

/**
 * Accessibility (warn-first) — epic #726.
 * Enable every `eslint-plugin-vuejs-accessibility` recommended rule, but at
 * `warn` rather than `error`, so a11y issues surface in lint/CI without walling
 * existing code red. Derived from the plugin's own recommended set so it stays
 * in sync if rules are added/removed upstream. Scoped to *.vue only (the Nuxt
 * config already wires vue-eslint-parser for templates) to avoid the plugin's
 * global config entry touching non-Vue files. Tighten to `error` once the
 * existing backlog is cleared.
 */
const a11yWarnRules = Object.fromEntries(
  Object.keys(
    pluginVueA11y.configs['flat/recommended'].find(c => c.rules)?.rules ?? {}
  ).map(rule => [rule, 'warn'])
)
export default createConfigForNuxt({
  features: {
    // Enable tooling rules for library/module development
    tooling: true,
    // Enable stylistic formatting rules (replaces Prettier)
    // Matches app configs in apps/*/nuxt.config.ts
    stylistic: {
      semi: false,
      quotes: 'single',
      indent: 2,
      commaDangle: 'never',
      braceStyle: '1tbs'
    }
  },
  dirs: {
    // Only lint packages from root (apps have their own configs)
    src: ['packages']
  }
})
  .append({
    // Global ignores
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      // Apps are linted by their own configs
      'apps/**',
      // The docs site (relocated from apps/docs) lints via its own config
      'docs/**',
      // POCs (not-yet-live) are excluded from the shared pipeline
      'pocs/**',
      // Deliberately-bad gate smoke fixtures (#1035) — never lint-clean on purpose
      '.claude/gate-fixtures/**'
    ]
  })
  .append({
    // Rules for all files (following Nuxt core patterns)
    rules: {
      // Allow console in CLI tools
      'no-console': 'off',
      // Allow any type (common in utility packages, Nuxt UI does the same)
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow dynamic delete (common in Vue reactive patterns)
      '@typescript-eslint/no-dynamic-delete': 'off',
      // Nuxt pages/layouts use file-based names (index.vue, login.vue, etc.)
      'vue/multi-word-component-names': 'off',
      // Allow require() in build scripts
      '@typescript-eslint/no-require-imports': 'off',
      // Allow empty object types (common in TypeScript)
      '@typescript-eslint/no-empty-object-type': 'off',
      // Unused vars: allow underscore prefix pattern (Nuxt convention)
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true
      }],
      // Allow mixed operators in complex conditions
      '@stylistic/no-mixed-operators': 'off'
    }
  })
  .append({
    // Accessibility checks on Vue templates, warn-first (epic #726, #727)
    name: 'vuejs-accessibility:warn-first',
    files: ['**/*.vue'],
    plugins: { 'vuejs-accessibility': pluginVueA11y },
    rules: a11yWarnRules
  })
  .append({
    // CLI generator files often have unused destructured variables
    // for consistency across generator functions
    files: ['packages/nuxt-crouton-cli/lib/**/*.mjs'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  })
  .append({
    // Test files have more relaxed rules for mocking and setup
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn'
    }
  })
  .append({
    // Flow package has complex type definitions
    files: ['packages/nuxt-crouton-flow/**/*.ts', 'packages/nuxt-crouton-flow/**/*.vue'],
    rules: {
      '@stylistic/no-mixed-operators': 'off'
    }
  })
