// @ts-check
import vue from 'eslint-plugin-vue'
import tsParser from '@typescript-eslint/parser'

/**
 * ESLint config for the frontend-review gate's lint step (#4071).
 *
 * Standalone on purpose — it does NOT extend `eslint.config.mjs`, so `pnpm lint` and the a11y
 * job are unchanged. It finds one thing: a plain `<button>`, `<input>`, `<select>` or
 * `<textarea>` where a Nuxt UI 4 component exists. `scripts/frontend-gate.mjs` keeps only the
 * hits on lines the PR adds, so the existing uses never turn a check red.
 *
 * `flat/base` brings the SFC parser, the processor and `vue/comment-directive`, so a tag that
 * must stay can carry
 *   <!-- eslint-disable-next-line vue/no-restricted-html-elements -- <reason> -->
 * (allowed only when the PR's ticket asks for it — `.claude/agents/build-reviewer.md`).
 *
 * Run: pnpm exec eslint -c eslint.frontend-gate.config.mjs --no-warn-ignored -f json <files>
 */
export default [
  ...vue.configs['flat/base'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tsParser } },
    rules: {
      'vue/no-restricted-html-elements': ['error',
        { element: 'button', message: 'Use UButton' },
        { element: 'input', message: 'Use UInput / UCheckbox / URadioGroup / UFileUpload' },
        { element: 'select', message: 'Use USelect / USelectMenu' },
        { element: 'textarea', message: 'Use UTextarea' }
      ]
    }
  }
]
