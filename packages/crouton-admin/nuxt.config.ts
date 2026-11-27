import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LocaleObject } from '@nuxtjs/i18n'
import { getLayerLocales } from '@fyit/crouton-i18n/config-utils'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Locales are driven by the app's crouton.config.js (same source the
// crouton-i18n layer uses) so this layer never re-adds locales an app turned off.
// A locale this layer ships no texts for is declared without a file (falls back).

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-admin')) {
  _dependencies.add('crouton-admin')
  console.log('🍞 crouton:admin ✓ Layer loaded')
}

export default defineNuxtConfig({
  // Note: crouton-auth should be extended by the consumer before crouton-admin
  // This ensures auth composables and server utils are available

  // Layer metadata
  $meta: {
    name: '@crouton/admin',
    version: '0.1.0'
  },

  // i18n configuration for admin translations
  i18n: {
    locales: getLayerLocales(join(currentDir, 'i18n/locales')) as LocaleObject[],
    langDir: '../i18n/locales'
  },

  // Components from the layer
  components: [
    { path: join(currentDir, 'app/components'), pathPrefix: false }
  ],

  // Auto-imports from the layer
  imports: {
    dirs: ['app/composables', 'app/utils']
  },

  // Runtime config defaults
  runtimeConfig: {
    // Public config
    public: {
      crouton: {
        admin: {
          routePrefix: '/super-admin',
          impersonation: true,
          statsRefreshInterval: 30000
        }
      } as any
    }
  },

  // Compatibility
  compatibilityDate: '2024-11-01',

  // Plugins
  plugins: [
    { src: join(currentDir, 'app/plugins/team-theme.ts') }
  ],

  // Nitro server config
  nitro: {
    imports: {
      dirs: ['server/utils']
    }
  }
})
