import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devServer: { port: 3001 },
  devtools: { enabled: true },
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-i18n',
    '@fyit/crouton-assets',
    '@fyit/crouton-pages',
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
    storageKey: 'alexdeforce-color-mode',
    dataValue: 'light'
  },

  runtimeConfig: {
    public: {
      croutonPages: {
        routingMode: 'custom',
        defaultLocale: 'nl'
      }
    }
  },

  croutonAuth: {
    methods: {
      passkeys: false
    },
    teams: {
      defaultTeamSlug: 'alexdeforce',
      allowCreate: false,
      showSwitcher: false,
      showManagement: false
    }
  },

  routeRules: {
    // Static assets — immutable cache
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },

    // NOTE: Do NOT add '/api/teams/*/...' SWR rules here — the wildcard
    // conflicts with radix3's :id parameter routing and breaks ALL
    // /api/teams/:id/* generated collection routes.

    // Auth — no caching
    '/auth/**': { headers: { 'cache-control': 'no-store' } },

    // Admin — no caching
    '/admin/**': { headers: { 'cache-control': 'no-store' } },

    // Legacy redirects — now managed via croutonRedirects collection in admin panel
    // Seed these via the admin UI or API:
    // /led002 → /archive/poezie/tussenbruggen
    // /led001 → /archive/poezie/hoek_van_de_laatste_zon
    // /tussenbruggen → /archive/poezie/tussenbruggen
    // /spiritjuweel1 → /archive/poezie/spiritjuweel-i-kwart-voor-straks
    // /archief → /archive
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