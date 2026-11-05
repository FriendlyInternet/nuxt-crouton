import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { LocaleObject } from '@nuxtjs/i18n'
import { getCroutonLocales } from '@fyit/crouton-i18n/config-utils'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

// Locales are driven by the app's crouton.config.js (same source the
// crouton-i18n layer uses) so this layer never re-adds locales an app turned off.
const croutonLocales = getCroutonLocales()

// Development startup log (deduplicated across layer resolution)
const _dependencies = (globalThis as unknown as Record<string, Set<string>>).__croutonLayers ??= new Set()
if (process.env.NODE_ENV !== 'production' && !_dependencies.has('crouton-auth')) {
  _dependencies.add('crouton-auth')
  console.log('🍞 crouton:auth ✓ Layer loaded')
}

export default defineNuxtConfig({
  // Register the auth module
  modules: [
    join(currentDir, 'module.ts')
  ],

  // Layer metadata
  $meta: {
    name: '@crouton/auth',
    version: '0.1.0'
  },

  // i18n configuration for auth translations
  i18n: {
    locales: croutonLocales.map(l => ({ code: l.code, name: l.name, file: l.file })) as LocaleObject[],
    langDir: '../i18n/locales'
  },

  // Runtime config defaults
  runtimeConfig: {
    // Server-only config
    auth: {
      secret: '', // BETTER_AUTH_SECRET
      baseUrl: '' // BETTER_AUTH_URL
    },

    // Public config
    public: {
      crouton: {
        auth: {
          signup: 'open',
          methods: {
            password: true,
            oauth: undefined,
            passkeys: false,
            twoFactor: false,
            magicLink: false
          },
          teams: {
            autoCreateOnSignup: false,
            defaultTeamSlug: undefined,
            allowCreate: true,
            limit: 0, // 0 = unlimited
            memberLimit: 100,
            showSwitcher: true,
            showManagement: true
          },
          ui: {
            theme: 'default' as const,
            redirects: {
              afterLogin: '/',
              afterLogout: '/',
              afterRegister: '/'
            }
          }
        }
      }
    }
  },

  // Compatibility
  compatibilityDate: '2024-11-01',

  // Nitro server config
  nitro: {
    imports: {
      dirs: ['server/utils']
    },
    // Override #crouton/team-auth to use Better Auth instead of direct DB queries
    alias: {
      '#crouton/team-auth': join(currentDir, 'server/utils/team-auth')
    }
  }
})
