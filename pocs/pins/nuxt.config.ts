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

  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-layout',
    '@fyit/crouton-i18n',
    // Generated collection layers must come last
    './layers/main'
  ],

  hub: {
    db: 'sqlite',
    kv: true
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Passkeys are incompatible with Cloudflare Workers (tsyringe) — disable them.
  croutonAuth: {
    methods: {
      passkeys: false
    }
  },

  // Cloudflare Workers deployment — disabling passkeys alone doesn't keep tsyringe
  // out of the server bundle; alias the CF-incompatible packages to no-op stubs like
  // every deployable crouton app (velo/booking-demo pattern). Without this the first
  // deploy fails Worker validation: "tsyringe requires a reflect polyfill" (10021).
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
