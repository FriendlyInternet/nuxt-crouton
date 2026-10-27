import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-bookings')) {
  _dependencies.add('crouton-bookings')
  console.log('🍞 crouton:bookings ✓ Layer loaded')
}

export default defineNuxtConfig({
  // The editor layer (email template editing) plus the five bookings collections
  // this package owns end to end (#2278): schema, queries, routes, list, composable.
  extends: [
    '@fyit/crouton-editor',
    '@fyit/crouton-calendar',
    join(currentDir, 'collections/bookings'),
    join(currentDir, 'collections/locations'),
    join(currentDir, 'collections/settings'),
    join(currentDir, 'collections/emailtemplates'),
    join(currentDir, 'collections/emaillogs')
  ],

  // Note: This is an addon layer - users must explicitly extend:
  // extends: ['@fyit/crouton-core', '@fyit/crouton-bookings']  (no generated ./layers/bookings since #2278)

  // i18n module is provided by nuxt-crouton-i18n layer
  // No need to declare it here - just provide locale files

  $meta: {
    description: 'Booking system layer for Nuxt Crouton - slot-based and inventory-based reservations',
    name: 'crouton-bookings'
  },

  // Component configuration - prefixed with CroutonBookings
  components: {
    dirs: [
      {
        path: join(currentDir, 'app/components'),
        prefix: 'CroutonBookings',
        global: true,
        priority: -1
      }
    ]
  },

  // Auto-import composables
  imports: {
    dirs: [join(currentDir, 'app/composables')]
  },

  // Auto-import server utilities
  nitro: {
    imports: {
      dirs: [join(currentDir, 'server/utils')]
    }
  },

  // Runtime config with email module options
  runtimeConfig: {
    // Server-only config
    croutonBookings: {
      email: {
        enabled: false // Set to true to enable email features
      }
    },
    // Public config
    public: {
      croutonBookings: {
        email: {
          enabled: false // Mirror for client-side awareness
        }
      }
    }
  },

  // i18n configuration - translations auto-merge when this layer is extended
  i18n: {
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'nl', name: 'Nederlands', file: 'nl.json' },
      { code: 'fr', name: 'Français', file: 'fr.json' }
    ],
    langDir: '../i18n/locales'
  }
})
