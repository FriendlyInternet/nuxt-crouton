import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-catalog')) {
  _dependencies.add('crouton-catalog')
  console.log('🍞 crouton:catalog ✓ Layer loaded')
}

export default defineNuxtConfig({
  $meta: {
    description: 'Shared team product list for nuxt-crouton: what a team offers',
    name: 'crouton-catalog'
  },

  // The products collection this package owns end to end:
  // schema, queries, routes, list, form, composable.
  extends: [join(currentDir, 'collections/products')],

  // i18n translations
  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'nl', name: 'Nederlands', file: 'nl.json' },
      { code: 'fr', name: 'Français', file: 'fr.json' }
    ],
    langDir: '../i18n/locales'
  }
})
