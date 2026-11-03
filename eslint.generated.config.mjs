// @ts-check
import base from './eslint.config.mjs'

/**
 * ESLint config for the `lint generated output` CI step (#2740).
 *
 * Lints what `crouton config` EMITS (the fixtures' regenerated collections) with
 * the repo rules, minus pure formatting: generated scaffolds are the app owner's
 * to format, but an unused import/variable or a leftover debug call is a template
 * bug and must fail. Run: `pnpm lint:generated` (after regenerating a fixture).
 */
const resolved = await base
const formattingRules = new Set()
for (const c of resolved) {
  for (const rule of Object.keys(c.rules ?? {})) {
    if (rule.startsWith('@stylistic/') || /^vue\/(html-|block-|multiline-|max-attributes|first-attribute|singleline-|mustache|attributes-order|v-on-event|script-indent|component-tags-order)/.test(rule)) {
      formattingRules.add(rule)
    }
  }
}

export default [
  ...resolved,
  {
    files: ['fixtures/*/layers/*/collections/**'],
    rules: Object.fromEntries([...formattingRules].map(r => [r, 'off']))
  }
]
