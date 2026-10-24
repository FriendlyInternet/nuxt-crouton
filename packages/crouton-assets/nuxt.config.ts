import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-assets')) {
  _dependencies.add('crouton-assets')
  console.log('🍞 crouton:assets ✓ Layer loaded')
}

export default defineNuxtConfig({
  $meta: {
    description: 'Asset management addon layer for nuxt-crouton with centralized media library',
    name: 'crouton-assets'
  },

  // The assets collection this package owns end to end (#2278):
  // schema, queries, routes, list, composable.
  extends: [join(currentDir, 'collections/assets')],

  // Enable blob storage for asset uploads
  // NuxtHub will merge this with the app's hub config
  hub: {
    blob: true
  },

  // Upload defaults (can be overridden in app nuxt.config.ts)
  runtimeConfig: {
    public: {
      croutonUpload: {
        maxSize: '10MB',
        allowedTypes: [] // Empty = use server defaults (all common types)
      }
    }
  },

  // Component configuration
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'CroutonAssets',
        global: true
      }
    ]
  },

  // Composables
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  },

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
