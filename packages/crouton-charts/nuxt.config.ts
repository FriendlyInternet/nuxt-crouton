import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-charts')) {
  _dependencies.add('crouton-charts')
  console.log('🍞 crouton:charts ✓ Layer loaded')
}

export default defineNuxtConfig({
  $meta: {
    description: 'Chart visualizations layer for Nuxt Crouton - collection-driven charts powered by nuxt-charts',
    name: 'crouton-charts'
  },

  // Extends crouton-core for collections and team context
  extends: ['@fyit/crouton-core'],

  // Register nuxt-charts module
  modules: ['nuxt-charts'],

  // Component configuration
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'CroutonCharts',
        global: true
      }
    ]
  },

  // Composables auto-import
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  },

  // i18n — translations auto-merge when this layer is extended (module from crouton-i18n)
  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'nl', name: 'Nederlands', file: 'nl.json' },
      { code: 'fr', name: 'Français', file: 'fr.json' }
    ],
    langDir: '../i18n/locales'
  }
})
