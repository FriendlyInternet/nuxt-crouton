import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-i18n',
    '@fyit/crouton-ai',
    '@fyit/crouton-assets',
    '@fyit/crouton-bookings',
    '@fyit/crouton-charts',
    '@fyit/crouton-collab',
    '@fyit/crouton-editor',
    '@fyit/crouton-email',
    '@fyit/crouton-events',
    '@fyit/crouton-flow',
    '@fyit/crouton-maps',
    '@fyit/crouton-pages',
    '@fyit/crouton-printing',
    '@fyit/crouton-sales',
    '@fyit/crouton-three',
    '@fyit/crouton-devtools'
  ],

  hub: {
    db: 'sqlite',
    kv: true
  },

  croutonEmail: {
    enabled: true
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    methods: {
      passkeys: false
    }
  },

  // Cloudflare Workers deployment — stub passkey/webauthn packages (tsyringe is
  // incompatible with workerd). Preset comes from NITRO_PRESET at build time.
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
  },

  runtimeConfig: {
    croutonBookings: {
      email: {
        enabled: false
      },

      bookingModes: ['slots']
    },

    public: {
      croutonBookings: {
        email: {
          enabled: false
        },

        bookingModes: ['slots']
      },

      croutonMaps: {
        style: 'liberty',
        geocodingUrl: 'https://nominatim.openstreetmap.org'
      },

      croutonSales: {
        print: {
          enabled: false
        }
      }
    },

    croutonMaps: {
      style: 'liberty',
      geocodingUrl: 'https://nominatim.openstreetmap.org'
    },

    croutonSales: {
      print: {
        enabled: false
      }
    }
  }
})