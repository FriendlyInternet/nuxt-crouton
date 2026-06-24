import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  css: ['~/assets/css/main.css'],
  devServer: { port: 3003 },

  // Register app components globally so resolveComponent() finds them
  // (needed by crouton-pages binder detail renderer)
  components: [
    { path: '~/components', global: true }
  ],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-i18n',
    '@fyit/crouton-assets',
    '@fyit/crouton-pages',
    '@fyit/crouton-maps',
    '@fyit/crouton-devtools/eruda',
    './layers/content',
    './layers/pages',
    './layers/crouton',
    './layers/site',
    '@fyit/crouton-editor'
  ],
  hub: {
    blob: true,
    db: 'sqlite'
  },

  ogImage: { enabled: false },

  colorMode: {
    preference: 'light',
    fallback: 'light',
    storageKey: 'sintlukas-color-mode',
    dataValue: 'light'
  },

  runtimeConfig: {
    public: {
      croutonPages: {
        routingMode: 'locale',
        defaultLocale: 'nl'
      }
    }
  },

  croutonAuth: {
    methods: {
      passkeys: false
    },
    teams: {
      defaultTeamSlug: 'sintlukas',
      allowCreate: false,
      showSwitcher: false,
      showManagement: false
    }
  },

  routeRules: {
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/auth/**': { headers: { 'cache-control': 'no-store' } },
    '/admin/**': { headers: { 'cache-control': 'no-store' } }
  },

  nitro: {
    alias: {
      '@better-auth/passkey/client': resolve(cfStubs, 'client'),
      '@better-auth/passkey': cfStubs,
      'tsyringe': cfStubs,
      'reflect-metadata': cfStubs,
      '@peculiar/x509': cfStubs,
      '@simplewebauthn/server': cfStubs,
      'papaparse': cfStubs
    }
  }
})
