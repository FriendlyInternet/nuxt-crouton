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
    '@fyit/crouton-email'
  ],
  hub: {
    db: 'sqlite',
    kv: true
  },

  // Disable OG Image to reduce bundle size for Cloudflare (saves ~4MB)
  ogImage: { enabled: false },

  // Owner-only sign-in by emailed link: no passwords, no passkeys. Who may request
  // a link (and that nobody can sign up) is enforced in server/middleware/owner-only.ts.
  croutonAuth: {
    methods: {
      password: false,
      passkeys: false,
      magicLink: true
    }
  },

  runtimeConfig: {
    // The one email allowed to sign in. Set ONLY as the Worker var NUXT_STATUS_OWNER_EMAIL
    // (never committed; public repo). Empty = nobody can sign in.
    statusOwnerEmail: '',
    // Seed the review-login passwords derive from. Pushed to the Worker by the staging deploy
    // (deploy-app.yml, status app only) as NUXT_REVIEW_SEED_SECRET; never committed.
    reviewSeedSecret: ''
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
