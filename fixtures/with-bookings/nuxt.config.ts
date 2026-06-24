// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-i18n',
    '@fyit/crouton-bookings',
    './layers/main',
    './layers/bookings',
  ],

  hub: {
    db: 'sqlite',
    kv: true
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility)
  croutonAuth: {
    methods: {
      passkeys: false
    }
  },

  runtimeConfig: {
    croutonBookings: {
      email: {
        enabled: false,
      },

      bookingModes: ['slots'],
    },

    public: {
      croutonBookings: {
        email: {
          enabled: false,
        },

        bookingModes: ['slots'],
      },
    },
  },
})