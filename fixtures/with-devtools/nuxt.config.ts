// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // @fyit/crouton-devtools is what `crouton init` adds (#595). In dev it
  // installModule's @fyit/crouton-feedback → the glasses launcher mounts. This
  // fixture exists to smoke that devtools → feedback wiring (#978).
  modules: ['@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  extends: ['@fyit/crouton-core', '@fyit/crouton-layout', '@fyit/crouton-i18n', './layers/main'],
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

})