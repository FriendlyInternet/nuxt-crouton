// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // crouton-printing MUST come before crouton-sales: the sales printing-subscriber
  // plugin reacts to the lifecycle hooks crouton-printing emits, so the printing
  // layer (which owns the generic print_jobs queue + drainer) has to load first.
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-i18n',
    '@fyit/crouton-printing',
    '@fyit/crouton-sales',
    './layers/sales'
  ],

  hub: {
    db: 'sqlite',
    kv: true
  },

  // Disable OG Image to reduce bundle size (matches with-bookings).
  ogImage: { enabled: false },

  // Disable passkeys for Cloudflare Workers (tsyringe incompatibility).
  croutonAuth: {
    methods: {
      passkeys: false
    }
  },

  // Sales runtime config: gate that controls whether order POST enqueues print
  // jobs. The fixture's whole point is the print path, so it's on.
  runtimeConfig: {
    croutonSales: {
      printApiKey: '1234',
      cloudSyncSecret: '',
      print: { enabled: true }
    }
  }
})
