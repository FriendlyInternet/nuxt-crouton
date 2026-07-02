import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfStubs = resolve(__dirname, 'server/utils/_cf-stubs')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@fyit/crouton', '@fyit/crouton-devtools'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // crouton-flow (Site level) rides Vue Flow; extended here (not default-on). No
  // flowId/sync used → no collab Durable Object binding needed (mirrors the demo POC).
  extends: ['@fyit/crouton-core', '@fyit/crouton-layout', '@fyit/crouton-flow', '@fyit/crouton-i18n', './layers/builder'],

  // View Transitions API — the graduated Page⇄Site morph (Replace: page-site-transition).
  // Matching `view-transition-name` on the flow card + the board makes the card grow
  // into the board and shrink back; replaces the POC's cross-fade stopgap.
  experimental: {
    viewTransition: true
  },
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
  }
})