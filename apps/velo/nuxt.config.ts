import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: { port: 3006 },
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-i18n',
    '@fyit/crouton-assets',
    '@fyit/crouton-pages',
    '@fyit/crouton-bookings',
    '@fyit/crouton-email',
    './layers/bookings',
    './layers/pages',
    '@fyit/crouton-maps',
    './layers/crouton'
  ],
  hub: {
    blob: true,
    db: 'sqlite'
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Enable booking email notifications
  runtimeConfig: {
    email: {
      from: 'noreply@messages.friendlyinter.net',
      fromName: 'Friendly Internet'
    },
    croutonBookings: {
      email: { enabled: true }
    },
    public: {
      crouton: {
        email: {
          brand: {
            name: 'Velotheek',
            primaryColor: '#0F766E',
            url: 'https://velo.friendlyinter.net'
          }
        }
      } as any,
      croutonBookings: {
        email: { enabled: true }
      }
    }
  },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    methods: {
      passkeys: false
    }
  },

  routeRules: {
    // Static assets — immutable cache (hashed filenames)
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },

    // Booking public APIs — SWR 5min (availability changes frequently)
    '/api/crouton-bookings/teams/*/availability': { swr: 300 },
    '/api/crouton-bookings/teams/*/locations': { swr: 600 },

    // NOTE: Do NOT add '/api/teams/*/pages' SWR rules here — the wildcard
    // conflicts with radix3's :id parameter routing and breaks ALL
    // /api/teams/:id/* generated collection routes (bookings-settings, etc.)

    // Auth pages — prerender (static, no data) + no caching fallback
    '/auth/login': { prerender: true },
    '/auth/register': { prerender: true },
    '/auth/forgot-password': { prerender: true },
    '/auth/**': { headers: { 'cache-control': 'no-store' } },

    // Admin — no caching (personalized)
    '/admin/**': { headers: { 'cache-control': 'no-store' } },
  },

  // Cloudflare Workers deployment — preset supplied at build via NITRO_PRESET
  // (cf:deploy/cf:staging); intentionally NOT pinned here so dev/build stay preset-free.
  nitro: {
    alias: {
      '@better-auth/passkey/client': resolve(cfStubs, 'client'),
      '@better-auth/passkey': cfStubs,
      'tsyringe': cfStubs,
      'reflect-metadata': cfStubs,
      '@peculiar/x509': cfStubs,
      '@simplewebauthn/server': cfStubs
    }
  }
})